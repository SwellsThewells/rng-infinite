--[[
	RNG∞ — client : l'interface du site en 2D plein écran (aucun personnage, aucun décor).
	Accueil → révélation au rythme du site → détail des badges ; historique, stats, collection, classement.
	Le serveur tire et score le nombre ; le client refait l'analyse avec le même moteur pour l'afficher.
]]
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local ContextActionService = game:GetService("ContextActionService")
local GuiService = game:GetService("GuiService")
local HttpService = game:GetService("HttpService")
local SoundService = game:GetService("SoundService")
local StarterGui = game:GetService("StarterGui")
local TextChatService = game:GetService("TextChatService")

local player = Players.LocalPlayer
local RNG = ReplicatedStorage:WaitForChild("RNG")
local Engine = require(RNG.Engine)
local Timing = require(RNG.Timing)
local Theme = require(RNG.Theme)
local Percentiles = require(RNG.Percentiles)
local remotes = ReplicatedStorage:WaitForChild("RNGRemotes")
local RollFn = remotes:WaitForChild("Roll")
local ProfileFn = remotes:WaitForChild("GetProfile")
local FeedEvent = remotes:WaitForChild("Feed")
local NoticeEvent = remotes:WaitForChild("Notice")
local boardValue = remotes:WaitForChild("Leaderboards")

local fmt = Engine.fmt
local TIER_RANK = Engine.TIER_RANK
local TIERS_DESC = { "mythic", "anomaly", "epic", "rare", "uncommon", "common", "trash" }
local hex = Color3.fromHex
local WHITE, BLACK = Color3.new(1, 1, 1), Color3.new(0, 0, 0)
local AUTO_XY, AUTO_Y = Enum.AutomaticSize.XY, Enum.AutomaticSize.Y
local H, V = Enum.FillDirection.Horizontal, Enum.FillDirection.Vertical
local CENTER, LEFT, RIGHT = Enum.HorizontalAlignment.Center, Enum.HorizontalAlignment.Left, Enum.HorizontalAlignment.Right
local MIDDLE = Enum.VerticalAlignment.Center
local PAGE_WIDTH = 736 -- 46rem, largeur des pages du site

local SOUNDS = {
	digit = { id = "rbxassetid://78684821207838", volume = 0.35 }, -- mixkit interface click
	badge = { id = "rbxassetid://137273815815490", volume = 0.4 }, -- bubble pop
	rarity = { id = "rbxassetid://0", volume = 0.6 },
}

-- Pas de personnage : on coupe tout ce qui en dépend, le chat reste pour jouer entre amis.
task.spawn(function()
	for _, t in { Enum.CoreGuiType.PlayerList, Enum.CoreGuiType.Backpack, Enum.CoreGuiType.Health, Enum.CoreGuiType.EmotesMenu } do
		pcall(StarterGui.SetCoreGuiEnabled, StarterGui, t, false)
	end
	for _ = 1, 20 do
		if pcall(StarterGui.SetCore, StarterGui, "ResetButtonCallback", false) then break end
		task.wait(0.5)
	end
end)

---------------------------------------------------------------------- utilitaires UI
local function new(class, props, children)
	local inst = Instance.new(class)
	local parent = nil
	for k, v in props or {} do
		if k == "Parent" then parent = v else inst[k] = v end
	end
	for _, c in children or {} do
		c.Parent = inst
	end
	inst.Parent = parent
	return inst
end

local function tween(inst, time, props, style, dir)
	local tw = TweenService:Create(inst, TweenInfo.new(time, style or Enum.EasingStyle.Quad, dir or Enum.EasingDirection.Out), props)
	tw:Play()
	return tw
end

local function corner(r)
	return new("UICorner", { CornerRadius = UDim.new(0, r) })
end
local function stroke(color, thickness, transparency)
	return new("UIStroke", { Color = color, Thickness = thickness or 1, Transparency = transparency or 0, ApplyStrokeMode = Enum.ApplyStrokeMode.Border })
end
local function padding(t, r, b, l)
	return new("UIPadding", {
		PaddingTop = UDim.new(0, t), PaddingRight = UDim.new(0, r or t),
		PaddingBottom = UDim.new(0, b or t), PaddingLeft = UDim.new(0, l or r or t),
	})
end
local function list(dir, gap, halign, valign, wraps)
	return new("UIListLayout", {
		FillDirection = dir or V, Padding = UDim.new(0, gap or 0), HorizontalAlignment = halign or LEFT,
		VerticalAlignment = valign or Enum.VerticalAlignment.Top, SortOrder = Enum.SortOrder.LayoutOrder, Wraps = wraps or false,
	})
end
local function text(props, children)
	props.BackgroundTransparency = props.BackgroundTransparency or 1
	props.FontFace = props.FontFace or Theme.font
	props.TextColor3 = props.TextColor3 or Theme.prose
	props.TextSize = props.TextSize or 14
	if props.AutomaticSize == AUTO_XY and not props.Size then props.Size = UDim2.new() end
	return new("TextLabel", props, children)
end
local function tbutton(props, children)
	props.AutoButtonColor = false
	props.BackgroundTransparency = props.BackgroundTransparency or 1
	props.FontFace = props.FontFace or Theme.fontBold
	props.TextColor3 = props.TextColor3 or Theme.prose
	props.TextSize = props.TextSize or 14
	if props.AutomaticSize == AUTO_XY and not props.Size then props.Size = UDim2.new() end
	return new("TextButton", props, children)
end
local function frame(props, children)
	props.BackgroundTransparency = props.BackgroundTransparency or 1
	props.BorderSizePixel = 0
	return new("Frame", props, children)
end
-- Petites capitales espacées comme le letter-spacing du site (espace fine entre les lettres).
local function spaced(s)
	return (string.gsub(string.upper(s), "([%w%p])", "%1\u{200A}"))
end
local function plural(k, word)
	return `{fmt(k)} {word}{if k == 1 then "" else "s"}`
end
local function relTime(t)
	local d = os.time() - t
	if d < 60 then return "just now" end
	if d < 3600 then return `{d // 60}m ago` end
	if d < 86400 then return `{d // 3600}h ago` end
	return `{d // 86400}d ago`
end
local function counter()
	local i = 0
	return function()
		i += 1
		return i
	end
end
local function spacer(parent, h, order)
	return frame({ Size = UDim2.new(1, 0, 0, h), LayoutOrder = order, Parent = parent })
end
local function countUp(label, from, to, duration, format)
	local token = (label:GetAttribute("countToken") or 0) + 1
	label:SetAttribute("countToken", token)
	if duration <= 0 then
		label.Text = format(to)
		return
	end
	local t0 = os.clock()
	task.spawn(function()
		while label:GetAttribute("countToken") == token and label.Parent do
			local k = math.min(1, (os.clock() - t0) / duration)
			label.Text = format(from + (to - from) * (1 - (1 - k) ^ 3))
			if k >= 1 then break end
			RunService.RenderStepped:Wait()
		end
	end)
end
local function popScale(guiObject, from, time)
	local scale = guiObject:FindFirstChildOfClass("UIScale") or new("UIScale", { Parent = guiObject })
	scale.Scale = from
	tween(scale, time or 0.3, { Scale = 1 }, Enum.EasingStyle.Back)
end

---------------------------------------------------------------------- sons
local soundTemplates = {}
for name, s in SOUNDS do
	if s.id == "rbxassetid://0" then continue end
	soundTemplates[name] = new("Sound", { Name = "RNG_" .. name, SoundId = s.id, Volume = s.volume, Parent = SoundService })
end
local function play(name, speed)
	local template = soundTemplates[name]
	if not template then return end
	local s = template:Clone()
	s.PlaybackSpeed = speed or 1
	s.Parent = SoundService
	s:Play()
	s.Ended:Connect(function() s:Destroy() end)
end

---------------------------------------------------------------------- racine, fond et mise à l'échelle
local gui = new("ScreenGui", {
	Name = "RNGInfinite", ResetOnSpawn = false, IgnoreGuiInset = true, ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
	DisplayOrder = 5, ScreenInsets = Enum.ScreenInsets.None, Parent = player:WaitForChild("PlayerGui"),
})
local rootScale = new("UIScale")
local root = frame({ Name = "Root", Parent = gui }, { rootScale })
frame({ Name = "Background", Size = UDim2.fromScale(1, 1), BackgroundColor3 = Theme.bg, BackgroundTransparency = 0, Parent = root })
local vignette = frame({ Name = "Vignette", Size = UDim2.fromScale(1, 1), BackgroundColor3 = BLACK, BackgroundTransparency = 1, Parent = root }, {
	new("UIGradient", { Rotation = 90, Transparency = NumberSequence.new({
		NumberSequenceKeypoint.new(0, 0.55), NumberSequenceKeypoint.new(0.3, 1), NumberSequenceKeypoint.new(0.7, 1), NumberSequenceKeypoint.new(1, 0.45),
	}) }),
})

local topbar = frame({ Name = "Topbar", BackgroundColor3 = Theme.bg, BackgroundTransparency = 0.12, ZIndex = 5, Parent = root })
local pageHost = frame({ Name = "Pages", Parent = root })

local navItems = {}
local baseWidth = 1000
local function rescale()
	local vp = workspace.CurrentCamera.ViewportSize
	local s = math.clamp(math.min(vp.X / 760, vp.Y / 620), 0.85, 1.5)
	rootScale.Scale = s
	root.Size = UDim2.fromScale(1 / s, 1 / s)
	baseWidth = vp.X / s
	local inset = GuiService:GetGuiInset().Y / s
	topbar.Position = UDim2.fromOffset(0, inset)
	topbar.Size = UDim2.new(1, 0, 0, 50)
	pageHost.Position = UDim2.fromOffset(0, inset + 50)
	pageHost.Size = UDim2.new(1, 0, 1, -(inset + 50))
	for _, item in navItems do
		item.button.Text = if baseWidth < 720 then item.icon else `{item.icon}  {spaced(item.label)}`
	end
end
workspace.CurrentCamera:GetPropertyChangedSignal("ViewportSize"):Connect(rescale)

---------------------------------------------------------------------- éléments du site
-- Contour animé du bouton Generate (ring-cycle de 14 s du site).
local RING = { hex("#ec4899"), hex("#a855f7"), hex("#3b82f6"), hex("#10b981"), hex("#f97316") }
local ringGradients = {}
RunService.RenderStepped:Connect(function()
	if #ringGradients == 0 then return end
	local p = (os.clock() % 14) / 14 * 5
	local i, f = math.floor(p), p - math.floor(p)
	local a = RING[i % 5 + 1]:Lerp(RING[(i + 1) % 5 + 1], f)
	local b = RING[(i + 1) % 5 + 1]:Lerp(RING[(i + 2) % 5 + 1], f)
	local cs = ColorSequence.new(a, b)
	for k = #ringGradients, 1, -1 do
		local entry = ringGradients[k]
		if entry.g:IsDescendantOf(gui) then
			entry.seen = true
			entry.g.Color = cs
		elseif entry.seen or not entry.g.Parent then
			table.remove(ringGradients, k)
		end
	end
end)

local function rollButton(label, small, onClick)
	local wrap = frame({ Name = "RollButton", AutomaticSize = AUTO_XY, Size = UDim2.new() }, { corner(8) })
	local glow = stroke(WHITE, if small then 5 else 9, 0.8)
	glow.Parent = wrap
	table.insert(ringGradients, { g = new("UIGradient", { Parent = glow }) })
	local b = tbutton({
		AutomaticSize = AUTO_XY, BackgroundColor3 = hex("#0a0a0a"), BackgroundTransparency = 0, Text = spaced(label),
		TextColor3 = WHITE, FontFace = Theme.fontHeavy, TextSize = if small then 16 else 28, Parent = wrap,
	}, { corner(7), padding(if small then 10 else 15, if small then 26 else 52), new("UIScale") })
	local border = stroke(WHITE, 2, 0)
	border.Parent = b
	table.insert(ringGradients, { g = new("UIGradient", { Parent = border }) })
	b.MouseEnter:Connect(function() tween(b.UIScale, 0.12, { Scale = 1.03 }) end)
	b.MouseLeave:Connect(function() tween(b.UIScale, 0.12, { Scale = 1 }) end)
	b.Activated:Connect(onClick)
	return wrap, b
end

local function tierPill(tier, size)
	local t = Theme.tier[tier]
	size = size or 1
	return text({
		Name = "Pill", AutomaticSize = AUTO_XY, Text = spaced(tier), TextSize = 10.5 * size, FontFace = Theme.fontBold,
		TextColor3 = t.pillText, BackgroundColor3 = t.pillBg, BackgroundTransparency = 1 - t.pillBgA,
	}, { corner(3), stroke(t.pillBorder, 1, 1 - t.pillBorderA), padding(3 * size, 6 * size) })
end

local function epPill(str, size)
	return text({
		Name = "EPPill", AutomaticSize = AUTO_XY, Text = str, TextSize = size or 11.5, FontFace = Theme.monoBold, TextColor3 = Theme.epText,
		BackgroundColor3 = Theme.epSurface, BackgroundTransparency = 0.7,
	}, { corner(99), stroke(Theme.epOutline, 1, 0.5), padding(2, 8) })
end

local function badgePill(b)
	local t = Theme.tier[b.tier]
	return text({
		AutomaticSize = AUTO_XY, Text = b.emoji .. " " .. b.label, TextSize = 11.5, FontFace = Theme.fontMedium,
		TextColor3 = t.pillText, BackgroundColor3 = t.pillBg, BackgroundTransparency = 1 - t.pillBgA,
	}, { corner(99), stroke(t.pillBorder, 1, 1 - t.pillBorderA), padding(2, 8) })
end

local function newTag(size)
	return text({ AutomaticSize = AUTO_XY, Text = spaced("new"), TextSize = 9 * (size or 1), FontFace = Theme.fontHeavy, TextColor3 = WHITE, BackgroundColor3 = Theme.success, BackgroundTransparency = 0 }, {
		corner(3), padding(2, 5),
	})
end

-- Carte numéro : dégradé + bordure de la rareté (neutre tant que la rareté n'est pas révélée).
local function numCard(str, tier, fontSize, padY, padX)
	local card = new("Frame", { Name = "NumCard", AutomaticSize = AUTO_XY, Size = UDim2.new(), BackgroundColor3 = WHITE, BorderSizePixel = 0 }, {
		corner(math.max(6, math.floor(fontSize * 0.24))), padding(padY, padX), list(H, 0, CENTER, MIDDLE), new("UIScale"),
	})
	local grad = new("UIGradient", { Rotation = 35, Parent = card })
	local st = stroke(Theme.outlineStrong, if fontSize >= 30 then 2 else 1.5, 0)
	st.Parent = card
	local label = if str then text({ AutomaticSize = AUTO_XY, Text = str, FontFace = Theme.monoBold, TextSize = fontSize, Parent = card }) else nil
	local function style(tier)
		local c = if tier then Theme.tier[tier] else Theme.neutral
		grad.Color = ColorSequence.new({ ColorSequenceKeypoint.new(0, c.from), ColorSequenceKeypoint.new(0.5, c.via), ColorSequenceKeypoint.new(1, c.to) })
		grad.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 1 - c.fromA), NumberSequenceKeypoint.new(0.5, 1 - c.viaA), NumberSequenceKeypoint.new(1, 1 - c.toA) })
		st.Color = c.border
		if label then label.TextColor3 = c.text end
	end
	style(tier)
	return card, style, st
end

local function sectionTitle(parent, str, order)
	return text({ Size = UDim2.new(1, 0, 0, 24), Text = spaced(str), TextSize = 18, FontFace = Theme.fontHeavy, LayoutOrder = order, Parent = parent })
end
local function eyebrow(parent, str, order, color)
	return text({ Size = UDim2.new(1, 0, 0, 16), Text = spaced(str), TextSize = 11, FontFace = Theme.fontBold, TextColor3 = color or Theme.prose3, LayoutOrder = order, Parent = parent })
end
local function pageTitle(parent, str, order)
	return text({ Size = UDim2.new(1, 0, 0, 44), Text = spaced(str), TextSize = 28, FontFace = Theme.fontHeavy, TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = order, Parent = parent })
end

---------------------------------------------------------------------- toast
local toastLabel = text({
	Name = "Toast", AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -28), AutomaticSize = AUTO_XY, Text = "",
	TextSize = 13, FontFace = Theme.fontSemi, BackgroundColor3 = Theme.surfaceRaised, BackgroundTransparency = 0, Visible = false, ZIndex = 50, Parent = root,
}, { corner(8), stroke(Theme.outline), padding(9, 14) })
local toastToken = 0
local function toast(msg)
	toastToken += 1
	local token = toastToken
	toastLabel.Text = msg
	toastLabel.Visible = true
	task.delay(3.2, function()
		if toastToken == token then toastLabel.Visible = false end
	end)
end

---------------------------------------------------------------------- profil local (copie du serveur)
local profile = { rolls = {}, rollCount = 0, lifetimeEP = 0, best = nil, badges = {}, saving = true }
local session = nil -- révélation en cours : { cancelled, canReroll, finished, stop }
local rolling = false
local currentPage = nil -- { name, frame }
local navigate, startRoll, openRollModal, openBadgeModal -- définis plus bas

local function isLocked()
	return rolling or (session ~= nil and not session.canReroll)
end

local function rollNumberOf(index)
	return profile.rollCount - (#profile.rolls - index)
end

---------------------------------------------------------------------- barre du haut
local topLeft = frame({ Size = UDim2.fromScale(0, 1), AutomaticSize = Enum.AutomaticSize.X, Parent = topbar }, { list(H, 6, LEFT, MIDDLE), padding(0, 0, 0, 16) })
local logo = tbutton({ AutomaticSize = AUTO_XY, Text = spaced("RNG∞"), TextSize = 16, FontFace = Theme.fontHeavy, LayoutOrder = 1, Parent = topLeft }, { padding(4, 8, 4, 0) })
logo.Activated:Connect(function() navigate("home") end)
for i, def in { { "history", "🕘", "History" }, { "stats", "📊", "Stats" }, { "badges", "🏅", "Badges" }, { "leaderboard", "🏆", "Leaderboard" } } do
	local b = tbutton({
		Name = "Nav_" .. def[1], AutomaticSize = AUTO_XY, Text = "", TextSize = 12, FontFace = Theme.fontSemi, BackgroundColor3 = Theme.surfaceRaised,
		BackgroundTransparency = 1, LayoutOrder = i + 1, Parent = topLeft,
	}, { corner(6), padding(6, 9) })
	b.MouseEnter:Connect(function() if not isLocked() then b.BackgroundTransparency = 0 end end)
	b.MouseLeave:Connect(function() b.BackgroundTransparency = if currentPage and currentPage.name == def[1] then 0 else 1 end)
	b.Activated:Connect(function() navigate(def[1]) end)
	navItems[def[1]] = { button = b, icon = def[2], label = def[3] }
end
local playerChip = text({
	AnchorPoint = Vector2.new(1, 0.5), Position = UDim2.new(1, -16, 0.5, 0), AutomaticSize = AUTO_XY,
	Text = "👤  " .. spaced(player.DisplayName), TextSize = 12, FontFace = Theme.fontBold, BackgroundColor3 = Theme.surface, BackgroundTransparency = 0, Parent = topbar,
}, { corner(7), stroke(Theme.outline), padding(8, 11) })
rescale()

local function refreshNav()
	local locked = isLocked()
	for name, item in navItems do
		local active = currentPage ~= nil and currentPage.name == name
		item.button.BackgroundTransparency = if active then 0 else 1
		item.button.TextTransparency = if locked then 0.55 else 0
	end
	logo.TextTransparency = if locked then 0.55 else 0
	playerChip.TextTransparency = if locked then 0.55 else 0
end

---------------------------------------------------------------------- pages
local function openPage(name)
	if currentPage then
		currentPage.frame:Destroy()
		currentPage.onClose()
	end
	local sf = new("ScrollingFrame", {
		Name = name, Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, BorderSizePixel = 0, ScrollBarThickness = 6,
		ScrollBarImageColor3 = Theme.outlineStrong, AutomaticCanvasSize = AUTO_Y, CanvasSize = UDim2.new(),
		ScrollingDirection = Enum.ScrollingDirection.Y, Parent = pageHost,
	}, { list(V, 0, CENTER), padding(0, 0, 90, 0) })
	local col = frame({ Name = "Column", Size = UDim2.new(1, -32, 0, 0), AutomaticSize = AUTO_Y, Parent = sf }, {
		new("UISizeConstraint", { MaxSize = Vector2.new(PAGE_WIDTH, math.huge) }), list(V, 0, CENTER),
	})
	local page = { name = name, frame = sf, onClose = function() end }
	currentPage = page
	refreshNav()
	return page, col, sf
end

---------------------------------------------------------------------- chiffres sous un badge
-- Chaque chiffre concerné reçoit sa couleur et son délai d'allumage (80 ms d'écart, groupe après groupe ;
-- Mountain/Valley s'allument depuis le centre), puis la rangée s'allume et s'éteint en boucle.
local function digitRow(n, badge, mini)
	local s = tostring(n)
	local groups = Engine.highlight(badge.id, n)
	local tierColors = Theme.tier[badge.tier]
	local multi = #groups > 1
	local info, offset = {}, 0
	for gi, g in groups do
		local pair = if multi then Theme.groupColors[(gi - 1) % #Theme.groupColors + 1] else nil
		for k, i in g do
			if not info[i] then
				info[i] = { bg = if pair then pair[1] else tierColors.hl, bd = if pair then pair[2] else tierColors.hlBorder, delay = offset + 80 * (k - 1) }
			end
		end
		offset += 80 * #g + 100
	end
	if badge.id == "MOUNTAIN" or badge.id == "VALLEY" then
		local idx = {}
		for i in info do
			table.insert(idx, i)
		end
		table.sort(idx)
		local mid = idx[#idx // 2 + 1]
		for i, v in info do
			v.delay = 80 * math.abs(i - mid)
		end
	end
	local w, h, size = if mini then 15 else 19, if mini then 18 else 22, if mini then 9.5 else 11
	local row = frame({ Name = "Digits", AutomaticSize = AUTO_XY, Size = UDim2.new() }, { list(H, if mini then 3 else 4, LEFT, MIDDLE) })
	local tiles = {}
	for i = 1, #s do
		local t = info[i]
		local tile = text({
			Size = UDim2.fromOffset(w, h), Text = string.sub(s, i, i), FontFace = if t then Theme.monoBold else Theme.mono,
			TextSize = size, TextColor3 = Theme.prose3, BackgroundColor3 = Theme.bg, BackgroundTransparency = 1, LayoutOrder = i, Parent = row,
		}, { corner(if mini then 3 else 4) })
		local st = stroke(Theme.outline, 1, 0)
		st.Parent = tile
		if t then
			table.insert(tiles, { tile = tile, stroke = st, scale = new("UIScale", { Parent = tile }), bg = t.bg, bd = t.bd, delay = t.delay })
		end
	end
	return row, tiles
end

local function lightTile(t, on)
	local time = if on then 0.25 else 0.35
	tween(t.tile, time, { BackgroundTransparency = if on then 0 else 1, TextColor3 = if on then BLACK else Theme.prose3 })
	t.tile.BackgroundColor3 = t.bg
	tween(t.stroke, time, { Color = if on then t.bd else Theme.outline })
	if on then
		t.scale.Scale = 1.22
		tween(t.scale, 0.35, { Scale = 1 })
	end
end

-- Vague d'allumage, maintien 1,8 s, extinction, pause 0,4 s, recommence ; s'arrête quand la carte disparaît.
local function loopTiles(tiles, holder, startDelay)
	if #tiles == 0 then return end
	local span = 0
	for _, t in tiles do
		span = math.max(span, t.delay)
	end
	task.spawn(function()
		task.wait(startDelay)
		while holder.Parent do
			for _, t in tiles do
				task.delay(t.delay / 1000, lightTile, t, true)
			end
			task.wait((span + 250 + 1800) / 1000)
			if not holder.Parent then break end
			for _, t in tiles do
				task.delay(t.delay / 1000, lightTile, t, false)
			end
			task.wait((span + 350 + 400) / 1000)
		end
	end)
end

---------------------------------------------------------------------- carte de badge (.badge-card du site)
local function badgeName(b, size)
	local nameBtn = tbutton({ AutomaticSize = AUTO_XY, Text = spaced(b.label), TextSize = size, FontFace = Theme.fontSemi })
	nameBtn.Activated:Connect(function() openBadgeModal(b.id) end)
	return nameBtn
end

local function badgeCard(group, n, newSet, animate)
	local b = group.badge
	local tierColors = Theme.tier[b.tier]
	local card = frame({ Name = b.id, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = AUTO_Y, BackgroundColor3 = Theme.surface, BackgroundTransparency = 0 }, {
		corner(8), padding(10, 12, 9, 12), list(V, 0), new("UIScale"),
	})
	stroke(Theme.outline:Lerp(tierColors.border, 0.5), 1, 0).Parent = card

	local head = frame({ Name = "Head", Size = UDim2.new(1, 0, 0, 0), AutomaticSize = AUTO_Y, LayoutOrder = 1, Parent = card })
	local title = frame({ Size = UDim2.new(1, -110, 0, 0), AutomaticSize = AUTO_Y, Parent = head }, { list(H, 7, LEFT, MIDDLE, true) })
	text({ AutomaticSize = AUTO_XY, Text = b.emoji, TextSize = 16, LayoutOrder = 1, Parent = title })
	local nameBtn = badgeName(b, 13)
	nameBtn.LayoutOrder = 2
	nameBtn.Parent = title
	local pill = tierPill(b.tier)
	pill.LayoutOrder = 3
	pill.Parent = title
	if newSet and newSet[b.id] then
		local tag = newTag()
		tag.LayoutOrder = 4
		tag.Parent = title
	end
	local ep = epPill(`+{fmt(b.score)} EP`)
	ep.AnchorPoint = Vector2.new(1, 0)
	ep.Position = UDim2.fromScale(1, 0)
	ep.Parent = head

	text({
		Size = UDim2.new(1, 0, 0, 0), AutomaticSize = AUTO_Y, Text = spaced(b.desc), TextColor3 = Theme.prose3, TextSize = 10.5,
		TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 2, Parent = card,
	}, { padding(5, 0, 7, 0) })
	local detail = Engine.badgeDetail(b.id, n)
	if detail ~= "" then
		text({ Size = UDim2.new(1, 0, 0, 18), Text = detail, TextColor3 = Theme.prose2, FontFace = Theme.mono, TextSize = 11, TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 3, Parent = card })
	end
	local digitsBox = frame({ Size = UDim2.new(1, 0, 0, 31), LayoutOrder = 4, Parent = card })
	frame({ Size = UDim2.new(1, 0, 0, 1), BackgroundColor3 = Theme.outline, BackgroundTransparency = 0, Parent = digitsBox })
	local row, tiles = digitRow(n, b, false)
	row.Position = UDim2.fromOffset(0, 8)
	row.Parent = digitsBox
	local allTiles = { tiles }

	for i, sb in group.subsidiary do
		local sub = frame({ Name = sb.id, Size = UDim2.new(1, 0, 0, 24), LayoutOrder = 10 + i, Parent = card })
		local leftSide = frame({ Size = UDim2.new(1, -150, 1, 0), Parent = sub }, { list(H, 6, LEFT, MIDDLE) })
		text({ AutomaticSize = AUTO_XY, Text = "└", TextColor3 = Theme.prose3, TextSize = 13, LayoutOrder = 1, Parent = leftSide })
		text({ AutomaticSize = AUTO_XY, Text = sb.emoji, TextSize = 13, LayoutOrder = 2, Parent = leftSide })
		local subName = badgeName(sb, 11.5)
		subName.TextColor3 = Theme.prose2
		subName.LayoutOrder = 3
		subName.Parent = leftSide
		if newSet and newSet[sb.id] then
			local tag = newTag(0.9)
			tag.LayoutOrder = 4
			tag.Parent = leftSide
		end
		local rightSide = frame({ AnchorPoint = Vector2.new(1, 0), Position = UDim2.fromScale(1, 0), Size = UDim2.new(0, 150, 1, 0), Parent = sub }, { list(H, 6, RIGHT, MIDDLE) })
		local subRow, subTiles = digitRow(n, sb, true)
		subRow.LayoutOrder = 1
		subRow.Parent = rightSide
		text({ AutomaticSize = AUTO_XY, Text = "(earned)", TextColor3 = Theme.prose3, TextSize = 10.5, LayoutOrder = 2, Parent = rightSide })
		table.insert(allTiles, subTiles)
	end

	for _, t in allTiles do
		loopTiles(t, card, if animate then 0.45 else 0.1)
	end
	if animate then popScale(card, 0.94, 0.4) end
	return card
end

---------------------------------------------------------------------- effets
local fxLayer = frame({ Name = "FX", Size = UDim2.fromScale(1, 1), ZIndex = 45, Parent = root })
local CONF_SPEED = { epic = 7, anomaly = 9, mythic = 12 }

local function celebrate(tier, target)
	local c = Theme.confetti[tier]
	if not c then return end
	local s = rootScale.Scale
	local origin = (target.AbsolutePosition + target.AbsoluteSize / 2 - root.AbsolutePosition) / s
	local speed = CONF_SPEED[tier] * 60
	local parts = {}
	for i = 1, c.count do
		local ang = math.random() * math.pi * 2
		local sp = speed * (0.35 + math.random())
		table.insert(parts, {
			f = frame({
				AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromOffset(origin.X, origin.Y), Size = UDim2.fromOffset(4 + math.random() * 5, 6 + math.random() * 8),
				Rotation = math.random() * 360, BackgroundColor3 = c.colors[(i - 1) % #c.colors + 1], BackgroundTransparency = 0, Parent = fxLayer,
			}),
			x = origin.X, y = origin.Y, vx = math.cos(ang) * sp, vy = math.sin(ang) * sp - speed * 0.35,
			vr = (math.random() - 0.5) * 1000, life = 0, max = (70 + math.random() * 60) / 60,
		})
	end
	if tier == "mythic" then
		local flash = frame({ Size = UDim2.fromScale(1, 1), BackgroundColor3 = WHITE, BackgroundTransparency = 0.5, Parent = fxLayer }, {
			new("UIGradient", { Color = ColorSequence.new({ ColorSequenceKeypoint.new(0, hex("#ec4899")), ColorSequenceKeypoint.new(0.5, hex("#a855f7")), ColorSequenceKeypoint.new(1, hex("#22d3ee")) }), Rotation = 60 }),
		})
		tween(flash, 1, { BackgroundTransparency = 1 }).Completed:Connect(function() flash:Destroy() end)
	end
	local conn
	conn = RunService.RenderStepped:Connect(function(dt)
		local damp = 0.985 ^ (dt * 60)
		local alive = 0
		for _, p in parts do
			if not p.f then continue end
			p.life += dt
			if p.life >= p.max then
				p.f:Destroy()
				p.f = nil
				continue
			end
			alive += 1
			p.vy += 792 * dt
			p.vx *= damp
			p.vy *= damp
			p.x += p.vx * dt
			p.y += p.vy * dt
			p.f.Position = UDim2.fromOffset(p.x, p.y)
			p.f.Rotation += p.vr * dt
			p.f.BackgroundTransparency = p.life / p.max
		end
		if alive == 0 then conn:Disconnect() end
	end)
end

-- Tremblement de la carte (anomaly / mythic) : on décale le contenu via le padding pour ne pas casser la mise en page.
local function shake(card)
	local pad = card:FindFirstChildOfClass("UIPadding")
	local left, right = pad.PaddingLeft, pad.PaddingRight
	task.spawn(function()
		for _, dx in { -1, 3, -5, 5, -5, 5, -5, 3, -1, 0 } do
			pad.PaddingLeft = UDim.new(0, left.Offset + dx)
			pad.PaddingRight = UDim.new(0, right.Offset - dx)
			task.wait(0.05)
		end
		pad.PaddingLeft, pad.PaddingRight = left, right
	end)
end

---------------------------------------------------------------------- fenêtre modale
-- Fond cliquable (ferme) et carte séparés : un clic dans la carte ne doit pas remonter jusqu'au fond.
local modal = frame({ Name = "Modal", Size = UDim2.fromScale(1, 1), Visible = false, ZIndex = 40, Parent = root })
local backdrop = tbutton({ Name = "Backdrop", Size = UDim2.fromScale(1, 1), BackgroundColor3 = BLACK, BackgroundTransparency = 0.4, Text = "", Parent = modal })
local function closeModal()
	for _, c in modal:GetChildren() do
		if c ~= backdrop then c:Destroy() end
	end
	modal.Visible = false
end
backdrop.Activated:Connect(closeModal)

local function openModal(build)
	closeModal()
	local card = tbutton({
		AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.52), Size = UDim2.new(1, -32, 0.84, 0), Text = "",
		BackgroundColor3 = Theme.surfaceDim, BackgroundTransparency = 0, Parent = modal,
	}, { corner(12), stroke(Theme.outline), new("UISizeConstraint", { MaxSize = Vector2.new(540, 760) }) })
	local close = tbutton({ AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, -10, 0, 10), Size = UDim2.fromOffset(32, 32), Text = "✕", TextSize = 16, TextColor3 = Theme.prose2, ZIndex = 2, Parent = card })
	close.Activated:Connect(closeModal)
	local sf = new("ScrollingFrame", {
		Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, BorderSizePixel = 0, ScrollBarThickness = 5, ScrollBarImageColor3 = Theme.outlineStrong,
		AutomaticCanvasSize = AUTO_Y, CanvasSize = UDim2.new(), ScrollingDirection = Enum.ScrollingDirection.Y, Parent = card,
	}, { list(V, 0, CENTER), padding(22, 20, 22, 20) })
	build(sf)
	modal.Visible = true
end

-- Détail d'un tirage passé : même rendu que la révélation, sans l'attente.
function openRollModal(n, rollNumber, t)
	openModal(function(body)
		local o = counter()
		local a = Engine.analyze(n)
		eyebrow(body, `roll #{fmt(rollNumber)} · {relTime(t)}`, o())
		spacer(body, 12, o())
		local card = numCard(a.str, a.tier, 38, 5, 16)
		card.LayoutOrder = o()
		card.Parent = body
		spacer(body, 12, o())
		local meta = frame({ AutomaticSize = AUTO_XY, Size = UDim2.new(), LayoutOrder = o(), Parent = body }, { list(H, 9, CENTER, MIDDLE) })
		tierPill(a.tier).Parent = meta
		local label, color = Engine.percentileLabel(a.percentile)
		text({ AutomaticSize = AUTO_XY, Text = label, TextColor3 = color, TextSize = 13, FontFace = Theme.fontSemi, LayoutOrder = 2, Parent = meta })
		spacer(body, 10, o())
		local ep = epPill(`{fmt(a.total)} EP`, 15)
		ep.LayoutOrder = o()
		ep.Parent = body
		spacer(body, 22, o())
		sectionTitle(body, "Badge breakdown", o())
		eyebrow(body, plural(#a.earned, "badge") .. " earned", o(), Theme.prose2)
		spacer(body, 12, o())
		local listFrame = frame({ Size = UDim2.new(1, 0, 0, 0), AutomaticSize = AUTO_Y, LayoutOrder = o(), Parent = body }, { list(V, 10) })
		for i, g in a.groups do
			local c = badgeCard(g, n, nil, false)
			c.LayoutOrder = i
			c.Parent = listFrame
		end
	end)
end

function openBadgeModal(id)
	local b = Engine.byId[id]
	if not b then return end
	openModal(function(body)
		local o = counter()
		local e = profile.badges[b.id]
		text({ AutomaticSize = AUTO_XY, Text = b.emoji, TextSize = 48, LayoutOrder = o(), Parent = body })
		text({ AutomaticSize = AUTO_XY, Text = spaced(b.label), TextSize = 20, FontFace = Theme.fontHeavy, LayoutOrder = o(), Parent = body }, { padding(6, 0) })
		local row = frame({ AutomaticSize = AUTO_XY, Size = UDim2.new(), LayoutOrder = o(), Parent = body }, { list(H, 8, CENTER, MIDDLE) })
		tierPill(b.tier).Parent = row
		local ep = epPill(`+{fmt(b.score)} EP`, 12)
		ep.LayoutOrder = 2
		ep.Parent = row
		spacer(body, 14, o())
		text({ Size = UDim2.new(1, 0, 0, 0), AutomaticSize = AUTO_Y, Text = b.desc, TextSize = 15, TextColor3 = Theme.prose2, TextWrapped = true, LayoutOrder = o(), Parent = body })
		spacer(body, 18, o())
		eyebrow(body, "odds", o())
		text({ AutomaticSize = AUTO_XY, Text = `1 in {fmt(b.score / 100)} rolls`, TextSize = 17, FontFace = Theme.monoBold, LayoutOrder = o(), Parent = body })
		if b.family then
			spacer(body, 12, o())
			text({ Size = UDim2.new(1, 0, 0, 0), AutomaticSize = AUTO_Y, Text = "Part of a family: only the best badge of a family counts toward your EP.", TextSize = 12.5, TextColor3 = Theme.prose3, TextWrapped = true, LayoutOrder = o(), Parent = body })
		end
		spacer(body, 18, o())
		eyebrow(body, "your record", o())
		text({
			Size = UDim2.new(1, 0, 0, 0), AutomaticSize = AUTO_Y, RichText = true, TextWrapped = true, TextSize = 15, LayoutOrder = o(), Parent = body,
			Text = if e then `Earned <b>{fmt(e[1])}×</b> · first on <b>{e[2]}</b> ({relTime(e[3])})` else '<font color="#9a9a9a">Not earned yet</font>',
		})
	end)
end

---------------------------------------------------------------------- accueil
local function renderHome()
	local page, col = openPage("home")
	local o = counter()
	spacer(col, 44, o())

	local qmarks = frame({ AutomaticSize = AUTO_XY, Size = UDim2.new(), LayoutOrder = o(), Parent = col }, { list(H, 0, CENTER, MIDDLE) })
	local chars = {}
	for i = 1, 6 do
		local holder = frame({ Size = UDim2.fromOffset(42, 82), LayoutOrder = i, Parent = qmarks })
		chars[i] = text({ Size = UDim2.fromScale(1, 1), Text = "?", FontFace = Theme.monoBold, TextSize = 70, TextColor3 = Theme.qmark, Parent = holder })
	end
	local t0 = os.clock()
	local floatConn = RunService.RenderStepped:Connect(function()
		for i, label in chars do
			local phase = ((os.clock() - t0 - 0.15 * (i - 1)) % 3.2) / 3.2
			local k = (1 - math.cos(phase * math.pi * 2)) / 2
			label.Position = UDim2.fromOffset(0, -4 * k)
			label.TextTransparency = 0.3 * k
		end
	end)
	page.onClose = function() floatConn:Disconnect() end

	text({ Size = UDim2.new(1, 0, 0, 0), AutomaticSize = AUTO_Y, Text = "Infinite rolls. One number at a time. What will yours be?", TextSize = 17, TextColor3 = Theme.prose2, TextWrapped = true, LayoutOrder = o(), Parent = col }, {
		padding(22, 0, 32, 0),
	})
	local wrap = rollButton("Generate", false, function() startRoll() end)
	wrap.LayoutOrder = o()
	wrap.Parent = col

	local rolls = profile.rolls
	local hintParts = {}
	if profile.rollCount > 0 then table.insert(hintParts, `{plural(profile.rollCount, "roll")} · {fmt(profile.lifetimeEP)} lifetime EP`) end
	table.insert(hintParts, `playing as <b>{player.DisplayName}</b>`)
	table.insert(hintParts, 'press <font face="RobotoMono" color="#f0f0f0">[Space]</font>')
	text({ Size = UDim2.new(1, 0, 0, 0), AutomaticSize = AUTO_Y, RichText = true, Text = table.concat(hintParts, " · "), TextSize = 12, TextColor3 = Theme.prose2, TextWrapped = true, LayoutOrder = o(), Parent = col }, {
		padding(18, 0, 0, 0),
	})
	if profile.saving == false then
		text({ Size = UDim2.new(1, 0, 0, 18), Text = "⚠ progress isn't being saved on this server", TextSize = 12, TextColor3 = Theme.danger, LayoutOrder = o(), Parent = col })
	end

	-- Carte « Your best roll ».
	if profile.best then
		local bestIndex = nil
		for i, r in rolls do
			if r[1] == profile.best[1] and r[2] == profile.best[2] then bestIndex = i end
		end
		local a = Engine.analyze(profile.best[1])
		spacer(col, 28, o())
		local feature = tbutton({ Size = UDim2.fromOffset(304, 0), AutomaticSize = AUTO_Y, Text = "", BackgroundColor3 = Theme.surface, BackgroundTransparency = 0, LayoutOrder = o(), Parent = col }, {
			corner(10), stroke(Theme.outline), padding(16, 16, 18, 16), list(V, 0, CENTER),
		})
		local fo = counter()
		eyebrow(feature, "your best roll", fo())
		spacer(feature, 12, fo())
		local card = numCard(a.str, a.tier, 38, 5, 16)
		card.LayoutOrder = fo()
		card.Parent = feature
		local when = if bestIndex then `roll #{fmt(rollNumberOf(bestIndex))} · {relTime(rolls[bestIndex][3])}` else relTime(profile.best[3])
		text({ Size = UDim2.new(1, 0, 0, 30), Text = when, TextSize = 11.5, TextColor3 = Theme.prose3, LayoutOrder = fo(), Parent = feature })
		local pills = frame({ Size = UDim2.new(1, 0, 0, 0), AutomaticSize = AUTO_Y, LayoutOrder = fo(), Parent = feature }, { list(H, 5, CENTER, MIDDLE, true) })
		for i = 1, math.min(7, #a.groups) do
			local p = badgePill(a.groups[i].badge)
			p.LayoutOrder = i
			p.Parent = pills
		end
		local more = #a.earned - math.min(7, #a.groups)
		if more > 0 then
			text({ AutomaticSize = AUTO_XY, Text = `+{more} more`, TextSize = 11, TextColor3 = Theme.prose3, LayoutOrder = 99, Parent = pills })
		end
		spacer(feature, 10, fo())
		local ep = epPill(`{fmt(a.total)} EP`, 13)
		ep.LayoutOrder = fo()
		ep.Parent = feature
		feature.Activated:Connect(function()
			openRollModal(profile.best[1], if bestIndex then rollNumberOf(bestIndex) else profile.rollCount, profile.best[3])
		end)
	end

	-- Bandeau des derniers tirages.
	if #rolls > 1 then
		spacer(col, 26, o())
		eyebrow(col, "recent rolls", o())
		spacer(col, 10, o())
		local chips = frame({ Size = UDim2.new(1, 0, 0, 0), AutomaticSize = AUTO_Y, LayoutOrder = o(), Parent = col }, { list(H, 6, CENTER, MIDDLE, true), new("UISizeConstraint", { MaxSize = Vector2.new(544, math.huge) }) })
		for k = 0, math.min(11, #rolls - 1) do
			local idx = #rolls - k
			local r = rolls[idx]
			local chip = tbutton({ AutomaticSize = AUTO_XY, Text = "", LayoutOrder = k, Parent = chips })
			local card = numCard(tostring(r[1]), Engine.cardTier(r[2]), 17, 2, 9)
			card.Parent = chip
			chip.Activated:Connect(function() openRollModal(r[1], rollNumberOf(idx), r[3]) end)
		end
	end
end

---------------------------------------------------------------------- révélation (écran de résultat)
local function notesInto(parent, res, a, order)
	local box = frame({ Size = UDim2.new(1, 0, 0, 0), AutomaticSize = AUTO_Y, LayoutOrder = order, Parent = parent }, { list(V, 6, CENTER) })
	if res.isFirst then
		text({ Size = UDim2.new(1, 0, 0, 0), AutomaticSize = AUTO_Y, Text = "First roll on RNG∞ — welcome!", TextSize = 12.5, FontFace = Theme.fontBold, TextColor3 = Theme.success, TextWrapped = true, Parent = box })
	end
	if res.newIds and #res.newIds > 0 then
		local items = {}
		for _, id in res.newIds do
			table.insert(items, Engine.byId[id])
		end
		table.sort(items, function(x, y) return x.score > y.score end)
		local names = {}
		for i = 1, math.min(4, #items) do
			table.insert(names, items[i].emoji .. " " .. items[i].label)
		end
		text({
			Size = UDim2.new(1, 0, 0, 0), AutomaticSize = AUTO_Y, TextSize = 12.5, FontFace = Theme.fontBold, TextColor3 = Theme.success, TextWrapped = true, Parent = box,
			Text = `✨ {plural(#items, "new badge")}: {table.concat(names, ", ")}{if #items > 4 then "…" else ""}`,
		})
	end
	if res.repeats and res.repeats > 0 and res.lastRepeat then
		text({
			Size = UDim2.new(1, 0, 0, 0), AutomaticSize = AUTO_Y, RichText = true, TextSize = 12, TextColor3 = Theme.prose2, TextWrapped = true, Parent = box,
			Text = `You've rolled <font face="RobotoMono"><b>{a.str}</b></font> before — {res.repeats}× (last {relTime(res.lastRepeat.t)}, roll #{fmt(res.lastRepeat.index)})`,
		})
	end
	return box
end

-- Révélation en étapes chronométrées, comme le site :
-- chiffres → badges un par un (EP qui monte) → nombre de badges → rareté → Top x % → EP à vie.
-- Rien ne se saute ; le menu reste verrouillé jusqu'à l'affichage de la rareté.
local function playReveal(res)
	closeModal()
	local n = res.n
	local a = Engine.analyze(n)
	if a.total ~= res.total then warn(`[RNG∞] écart client/serveur sur {n} : {a.total} vs {res.total}`) end
	local slotCount = math.max(6, #a.str)
	local padded = string.rep("0", slotCount - #a.str) .. a.str
	local lead = slotCount - #a.str
	local sched = Timing.schedule(slotCount, #a.groups)

	local s = { cancelled = false, canReroll = false, finished = false }
	session = s
	local page, col, sf = openPage("result")
	page.onClose = function()
		s.cancelled = true
		if s.stop then s.stop() end
		tween(vignette, 0.4, { BackgroundTransparency = 1 })
	end
	local o = counter()
	spacer(col, 30, o())

	-- Carte numéro et ses cases.
	local card, styleCard, cardStroke = numCard(nil, nil, 54, 6, 22)
	card.LayoutOrder = o()
	card.Parent = col
	local slots = {}
	for i = 1, slotCount do
		slots[i] = text({
			Name = "Slot" .. i, Size = UDim2.fromOffset(33, 64), Text = "0", FontFace = Theme.monoBold, TextSize = 54,
			TextColor3 = Theme.prose3, TextTransparency = 0.45, LayoutOrder = i, Parent = card,
		}, { new("UIScale") })
	end
	local meta = new("CanvasGroup", { AutomaticSize = AUTO_XY, Size = UDim2.new(), BackgroundTransparency = 1, GroupTransparency = 1, LayoutOrder = o(), Parent = col }, {
		list(H, 9, CENTER, MIDDLE), padding(16, 0, 0, 0),
	})
	tierPill(a.tier).Parent = meta
	text({ AutomaticSize = AUTO_XY, Text = "•", TextColor3 = Theme.prose3, TextSize = 13, LayoutOrder = 2, Parent = meta })
	local label, color = Engine.percentileLabel(a.percentile)
	text({ AutomaticSize = AUTO_XY, Text = label, TextColor3 = color, TextSize = 13, FontFace = Theme.fontSemi, LayoutOrder = 3, Parent = meta })

	spacer(col, 14, o())
	local ep = text({
		Name = "EP", AutomaticSize = AUTO_XY, Text = "??? EP", TextSize = 16, FontFace = Theme.monoBold, TextColor3 = Theme.prose2,
		BackgroundColor3 = Theme.surfaceRaised, BackgroundTransparency = 0, LayoutOrder = o(), Parent = col,
	}, { corner(99), padding(5, 13) })
	local epStroke = stroke(Theme.outline, 1, 0)
	epStroke.Parent = ep

	local life = new("CanvasGroup", { AutomaticSize = AUTO_XY, Size = UDim2.new(), BackgroundTransparency = 1, GroupTransparency = 1, LayoutOrder = o(), Parent = col }, {
		list(V, 0, CENTER), padding(8, 40, 0, 40),
	})
	local lifeRow = frame({ AutomaticSize = AUTO_XY, Size = UDim2.new(), LayoutOrder = 1, Parent = life })
	local lifeValue = text({ AutomaticSize = AUTO_XY, Text = fmt(res.lifetimeBefore), TextSize = 16, FontFace = Theme.monoBold, TextColor3 = Theme.prose2, Parent = lifeRow })
	local lifeDelta = text({
		AnchorPoint = Vector2.new(0, 0), Position = UDim2.new(1, 6, 0, -2), AutomaticSize = AUTO_XY, Text = `+{fmt(a.total)}`,
		TextSize = 12, FontFace = Theme.mono, TextColor3 = Theme.success, TextTransparency = 1, Parent = lifeRow,
	})
	text({ AutomaticSize = AUTO_XY, Text = spaced("your lifetime EP"), TextSize = 10.5, TextColor3 = Theme.prose3, LayoutOrder = 2, Parent = life })

	local actions = new("CanvasGroup", { AutomaticSize = AUTO_XY, Size = UDim2.new(), BackgroundTransparency = 1, GroupTransparency = 1, LayoutOrder = o(), Parent = col }, {
		list(H, 12, CENTER, MIDDLE), padding(18, 12, 6, 12),
	})
	local again, againBtn = rollButton("Roll again", true, function() startRoll() end)
	again.Parent = actions
	againBtn.Active = false
	local hint = text({
		AutomaticSize = AUTO_XY, RichText = true, TextTransparency = 1, TextSize = 12, TextColor3 = Theme.prose2, LayoutOrder = o(), Parent = col,
		Text = '<font face="RobotoMono" color="#f0f0f0">[Space]</font> to roll again · click a badge name for details',
	}, { padding(12, 0, 0, 0) })
	local notesOrder = o()

	spacer(col, 32, o())
	local breakdownTitle = sectionTitle(col, "Badge breakdown", o())
	breakdownTitle.Visible = false
	local countLabel = text({ Size = UDim2.new(1, 0, 0, 18), Text = spaced(plural(#a.earned, "badge") .. " earned"), TextSize = 11, FontFace = Theme.fontSemi, TextColor3 = Theme.prose2, TextTransparency = 1, LayoutOrder = o(), Parent = col })
	spacer(col, 14, o())
	local listFrame = frame({ Size = UDim2.new(1, 0, 0, 0), AutomaticSize = AUTO_Y, LayoutOrder = o(), Parent = col }, {
		list(V, 10), new("UISizeConstraint", { MaxSize = Vector2.new(496, math.huge) }),
	})

	tween(vignette, 0.8, { BackgroundTransparency = 0 })
	refreshNav()
	local t0 = os.clock()
	local function at(t, fn)
		task.delay(math.max(0, t0 + t - os.clock()), function()
			if not s.cancelled then fn() end
		end)
	end

	-- 1. Chiffres de gauche à droite, chacun un peu plus lent que le précédent.
	local revealed, lastSpin = 0, 0
	local spinConn = RunService.RenderStepped:Connect(function()
		if os.clock() - lastSpin < 0.055 then return end
		lastSpin = os.clock()
		for i = revealed + 1, slotCount do
			slots[i].Text = tostring(math.random(0, 9))
		end
	end)
	local charge = TweenService:Create(cardStroke, TweenInfo.new(0.8, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, true), { Color = hex("#6366f1") })
	charge:Play()
	s.stop = function()
		if spinConn then
			spinConn:Disconnect()
			spinConn = nil
		end
		charge:Cancel()
	end

	for i = 1, slotCount do
		at(sched.digits[i], function()
			local slot = slots[i]
			revealed = i
			slot.Text = string.sub(padded, i, i)
			slot.TextColor3 = Theme.prose2
			slot.TextTransparency = if i <= lead then 0.82 else 0
			popScale(slot, 1.25, 0.28)
			play("digit", 0.9 + i * 0.06)
		end)
	end
	at(sched.spinStop, function()
		s.stop()
		styleCard(nil)
		if lead > 0 then
			task.delay(0.26, function()
				for i = 1, lead do
					tween(slots[i], 0.35, { Size = UDim2.fromOffset(0, 64), TextTransparency = 1 })
				end
			end)
		end
	end)

	-- 2. Badges un par un, du moins rare au plus rare : chacun s'insère en haut et fait monter l'EP.
	local newSet = nil
	if not res.isFirst then
		newSet = {}
		for _, id in res.newIds do
			newSet[id] = true
		end
	end
	local running = 0
	local count = #a.groups
	for order = 1, count do
		local g = a.groups[count - order + 1]
		at(sched.badges[order], function()
			breakdownTitle.Visible = true
			local c = badgeCard(g, n, newSet, true)
			c.LayoutOrder = 10000 - order
			c.Parent = listFrame
			local from = running
			running += g.badge.score
			countUp(ep, from, running, Timing.REVEAL.badgeEp * Timing.BADGES / 1000, function(x) return fmt(x) .. " EP" end)
			play("badge", 0.85 + TIER_RANK[g.badge.tier] * 0.07)
		end)
	end

	-- 3. Résumé, rareté, Top x %, EP à vie.
	at(sched.summary, function()
		tween(countLabel, 0.45, { TextTransparency = 0 })
		notesInto(col, res, a, notesOrder)
	end)
	at(sched.rarity, function()
		local tierColors = Theme.tier[a.tier]
		styleCard(a.tier)
		for i = lead + 1, slotCount do
			slots[i].TextColor3 = tierColors.text
		end
		if a.tier == "anomaly" or a.tier == "mythic" then shake(card) else popScale(card, 0.9, 0.5) end
		countUp(ep, 0, a.total, 0, function(x) return fmt(x) .. " EP" end)
		ep.BackgroundColor3 = tierColors.pillBg
		ep.BackgroundTransparency = 1 - tierColors.pillBgA
		ep.TextColor3 = tierColors.pillText
		epStroke.Color = tierColors.pillBorder
		epStroke.Transparency = 1 - tierColors.pillBorderA
		celebrate(a.tier, card)
		play("rarity", 0.8 + TIER_RANK[a.tier] * 0.08)
		tween(actions, 0.45, { GroupTransparency = 0 })
		againBtn.Active = true
		tween(hint, 0.45, { TextTransparency = 0 })
		s.canReroll = true
		refreshNav()
	end)
	at(sched.stats, function()
		tween(meta, 0.4, { GroupTransparency = 0 })
		popScale(meta, 0.9, 0.5)
	end)
	at(sched.lifetimeShow, function()
		tween(life, 0.45, { GroupTransparency = 0 })
	end)
	at(sched.lifetimePause, function()
		lifeDelta.TextTransparency = 0
		lifeDelta.Position = UDim2.new(1, 6, 0, 2)
		tween(lifeDelta, 1.8, { TextTransparency = 1, Position = UDim2.new(1, 6, 0, -12) })
		countUp(lifeValue, res.lifetimeBefore, res.lifetimeBefore + a.total, Timing.REVEAL.lifetimeTick * Timing.BASE / 1000, fmt)
	end)
	at(sched.finish, function()
		tween(vignette, 0.8, { BackgroundTransparency = 1 })
		s.finished = true
	end)
end

---------------------------------------------------------------------- historique
local histState = { q = "", sort = "new" }

local function renderHistory()
	local _, col = openPage("history")
	local o = counter()
	spacer(col, 20, o())
	pageTitle(col, "History", o())
	text({ Size = UDim2.new(1, 0, 0, 22), Text = `{plural(profile.rollCount, "roll")} · {fmt(profile.lifetimeEP)} lifetime EP`, TextSize = 13, TextColor3 = Theme.prose3, TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = o(), Parent = col })
	spacer(col, 12, o())
	if #profile.rolls == 0 then
		local empty = frame({ Size = UDim2.new(1, 0, 0, 150), BackgroundColor3 = Theme.surface, BackgroundTransparency = 0, LayoutOrder = o(), Parent = col }, { corner(10), stroke(Theme.outline), list(V, 12, CENTER, MIDDLE) })
		text({ AutomaticSize = AUTO_XY, Text = "🎲", TextSize = 32, Parent = empty })
		text({ AutomaticSize = AUTO_XY, Text = "No rolls yet.", TextSize = 14, TextColor3 = Theme.prose2, LayoutOrder = 2, Parent = empty })
		return
	end

	local toolbar = frame({ Size = UDim2.new(1, 0, 0, 36), LayoutOrder = o(), Parent = col }, { list(H, 8, LEFT, MIDDLE) })
	local search = new("TextBox", {
		Size = UDim2.fromOffset(230, 34), BackgroundColor3 = Theme.surface, Text = histState.q, PlaceholderText = "Search a number…",
		PlaceholderColor3 = Theme.prose3, TextColor3 = Theme.prose, FontFace = Theme.mono, TextSize = 13, ClearTextOnFocus = false,
		TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 1, Parent = toolbar,
	}, { corner(7), stroke(Theme.outline), padding(0, 10) })
	local sortButtons = {}
	for i, def in { { "new", "Newest" }, { "best", "Best EP" } } do
		local b = tbutton({ AutomaticSize = AUTO_XY, Text = spaced(def[2]), TextSize = 11.5, BackgroundColor3 = Theme.surface, BackgroundTransparency = 0, LayoutOrder = 1 + i, Parent = toolbar }, {
			corner(7), stroke(Theme.outline), padding(9, 12),
		})
		sortButtons[def[1]] = b
	end
	spacer(col, 12, o())
	local rowsFrame = frame({ Size = UDim2.new(1, 0, 0, 0), AutomaticSize = AUTO_Y, LayoutOrder = o(), Parent = col }, { list(V, 6) })

	local function render()
		for _, c in rowsFrame:GetChildren() do
			if c:IsA("GuiObject") then c:Destroy() end
		end
		for key, b in sortButtons do
			b.BackgroundColor3 = if histState.sort == key then Theme.surfaceRaised else Theme.surface
			b.TextColor3 = if histState.sort == key then Theme.prose else Theme.prose2
		end
		local rolls = profile.rolls
		local indices = {}
		for i, r in rolls do
			if histState.q == "" or string.find(tostring(r[1]), histState.q, 1, true) then table.insert(indices, i) end
		end
		if histState.sort == "best" then
			table.sort(indices, function(x, y) return rolls[x][2] > rolls[y][2] or (rolls[x][2] == rolls[y][2] and x > y) end)
		else
			table.sort(indices, function(x, y) return x > y end)
		end
		for k = 1, math.min(#indices, 150) do
			local idx = indices[k]
			local r = rolls[idx]
			local tier = Engine.cardTier(r[2])
			local row = tbutton({ Size = UDim2.new(1, 0, 0, 44), Text = "", BackgroundColor3 = Theme.surface, BackgroundTransparency = 0, LayoutOrder = k, Parent = rowsFrame }, {
				corner(8), stroke(Theme.outline),
			})
			local leftSide = frame({ Size = UDim2.new(1, -200, 1, 0), Parent = row }, { list(H, 10, LEFT, MIDDLE), padding(0, 0, 0, 12) })
			text({ Size = UDim2.fromOffset(62, 20), Text = `#{fmt(rollNumberOf(idx))}`, FontFace = Theme.mono, TextSize = 12, TextColor3 = Theme.prose3, TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 1, Parent = leftSide })
			local chip = numCard(tostring(r[1]), tier, 16, 1, 8)
			chip.LayoutOrder = 2
			chip.Parent = leftSide
			local pill = tierPill(tier)
			pill.LayoutOrder = 3
			pill.Parent = leftSide
			text({ AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, -96, 0, 0), Size = UDim2.new(0, 110, 1, 0), Text = fmt(r[2]) .. " EP", FontFace = Theme.monoBold, TextSize = 13, TextXAlignment = Enum.TextXAlignment.Right, Parent = row })
			text({ AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, -12, 0, 0), Size = UDim2.new(0, 80, 1, 0), Text = relTime(r[3]), TextSize = 12, TextColor3 = Theme.prose3, TextXAlignment = Enum.TextXAlignment.Right, Parent = row })
			row.MouseEnter:Connect(function() row.BackgroundColor3 = Theme.surfaceRaised end)
			row.MouseLeave:Connect(function() row.BackgroundColor3 = Theme.surface end)
			row.Activated:Connect(function() openRollModal(r[1], rollNumberOf(idx), r[3]) end)
		end
		if #indices == 0 then
			text({ Size = UDim2.new(1, 0, 0, 60), Text = "No roll matches.", TextSize = 14, TextColor3 = Theme.prose3, Parent = rowsFrame })
		elseif #indices > 150 then
			text({ Size = UDim2.new(1, 0, 0, 30), Text = `Showing 150 of {fmt(#indices)} rolls`, TextSize = 12, TextColor3 = Theme.prose3, LayoutOrder = 999, Parent = rowsFrame })
		end
	end
	for key, b in sortButtons do
		b.Activated:Connect(function()
			histState.sort = key
			render()
		end)
	end
	search:GetPropertyChangedSignal("Text"):Connect(function()
		local q = string.gsub(search.Text, "%D", "")
		if q ~= search.Text then
			search.Text = q
			return
		end
		histState.q = q
		render()
	end)
	render()
end

---------------------------------------------------------------------- stats
local function renderStats()
	local _, col = openPage("stats")
	local o = counter()
	spacer(col, 20, o())
	pageTitle(col, "Stats", o())
	spacer(col, 8, o())
	local rolls = profile.rolls
	if #rolls == 0 then
		text({ Size = UDim2.new(1, 0, 0, 60), Text = "Roll a few numbers to see your stats.", TextSize = 14, TextColor3 = Theme.prose3, LayoutOrder = o(), Parent = col })
		return
	end

	local tierCounts, sum, bestStreakNoRare, streak = {}, 0, 0, 0
	for _, t in TIERS_DESC do
		tierCounts[t] = 0
	end
	for _, r in rolls do
		local t = Engine.cardTier(r[2])
		tierCounts[t] += 1
		sum += r[2]
		if TIER_RANK[t] >= TIER_RANK.rare then streak = 0 else streak += 1 end
		bestStreakNoRare = math.max(bestStreakNoRare, streak)
	end

	local cards = frame({ Size = UDim2.new(1, 0, 0, 0), AutomaticSize = AUTO_Y, LayoutOrder = o(), Parent = col }, {
		new("UIGridLayout", { CellSize = UDim2.new(0.25, -8, 0, 78), CellPadding = UDim2.fromOffset(10, 10), SortOrder = Enum.SortOrder.LayoutOrder }),
	})
	for i, def in {
		{ "rolls", fmt(profile.rollCount) },
		{ "lifetime EP", fmt(profile.lifetimeEP) },
		{ "average EP", fmt(sum / #rolls) },
		{ "best roll", if profile.best then tostring(profile.best[1]) else "—" },
	} do
		local c = frame({ BackgroundColor3 = Theme.surface, BackgroundTransparency = 0, LayoutOrder = i, Parent = cards }, { corner(10), stroke(Theme.outline), list(V, 4, CENTER, MIDDLE) })
		text({ Size = UDim2.new(1, -10, 0, 28), Text = def[2], TextSize = 22, FontFace = Theme.monoBold, TextScaled = false, TextTruncate = Enum.TextTruncate.AtEnd, LayoutOrder = 1, Parent = c })
		text({ Size = UDim2.new(1, 0, 0, 14), Text = spaced(def[1]), TextSize = 10, FontFace = Theme.fontBold, TextColor3 = Theme.prose3, LayoutOrder = 2, Parent = c })
	end

	spacer(col, 30, o())
	sectionTitle(col, "Rarity distribution", o())
	eyebrow(col, "your rolls vs the odds", o(), Theme.prose2)
	spacer(col, 14, o())
	local box = frame({ Size = UDim2.new(1, 0, 0, 0), AutomaticSize = AUTO_Y, BackgroundColor3 = Theme.surface, BackgroundTransparency = 0, LayoutOrder = o(), Parent = col }, {
		corner(10), stroke(Theme.outline), padding(14, 16), list(V, 10),
	})
	for i, t in TIERS_DESC do
		local share = tierCounts[t] / #rolls
		local expected = Percentiles.tierOdds[t]
		local row = frame({ Size = UDim2.new(1, 0, 0, 22), LayoutOrder = i, Parent = box })
		local pill = tierPill(t)
		pill.AnchorPoint = Vector2.new(0, 0.5)
		pill.Position = UDim2.fromScale(0, 0.5)
		pill.Parent = row
		local track = frame({ Position = UDim2.new(0, 96, 0.5, -5), Size = UDim2.new(1, -290, 0, 10), BackgroundColor3 = Theme.surfaceRaised, BackgroundTransparency = 0, Parent = row }, { corner(5) })
		frame({ Size = UDim2.new(math.clamp(share, 0, 1), 0, 1, 0), BackgroundColor3 = Theme.tier[t].accent, BackgroundTransparency = 0, Parent = track }, { corner(5) })
		frame({ Position = UDim2.new(math.clamp(expected, 0, 1), -1, 0, -3), Size = UDim2.new(0, 2, 1, 6), BackgroundColor3 = Theme.prose, BackgroundTransparency = 0.3, Parent = track })
		text({
			AnchorPoint = Vector2.new(1, 0), Position = UDim2.fromScale(1, 0), Size = UDim2.new(0, 180, 1, 0), RichText = true, TextSize = 12, FontFace = Theme.mono,
			TextXAlignment = Enum.TextXAlignment.Right, Parent = row,
			Text = `{tierCounts[t]} · {string.format("%.1f", share * 100)}% <font color="#9a9a9a">(exp {string.format("%.1f", expected * 100)}%)</font>`,
		})
	end
	spacer(col, 12, o())
	text({ Size = UDim2.new(1, 0, 0, 0), AutomaticSize = AUTO_Y, TextWrapped = true, TextSize = 12, TextColor3 = Theme.prose3, LayoutOrder = o(), Parent = col,
		Text = `White tick = expected share. Longest run without a Rare or better: {fmt(bestStreakNoRare)} rolls.` })
end

---------------------------------------------------------------------- collection
local function renderBadges()
	local _, col = openPage("badges")
	local o = counter()
	spacer(col, 20, o())
	pageTitle(col, "Badges", o())
	local owned = 0
	for _, b in Engine.badges do
		if profile.badges[b.id] then owned += 1 end
	end
	text({ Size = UDim2.new(1, 0, 0, 22), Text = `{owned} / {#Engine.badges} collected · click a badge for details`, TextSize = 13, TextColor3 = Theme.prose3, TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = o(), Parent = col })
	spacer(col, 14, o())
	local grid = frame({ Size = UDim2.new(1, 0, 0, 0), AutomaticSize = AUTO_Y, LayoutOrder = o(), Parent = col }, {
		new("UIGridLayout", { CellSize = UDim2.fromOffset(136, 104), CellPadding = UDim2.fromOffset(8, 8), SortOrder = Enum.SortOrder.LayoutOrder, HorizontalAlignment = CENTER }),
	})
	for i, b in Engine.badges do
		local e = profile.badges[b.id]
		local t = Theme.tier[b.tier]
		local tile = tbutton({ Text = "", BackgroundColor3 = Theme.surface, BackgroundTransparency = 0, LayoutOrder = i, Parent = grid }, {
			corner(8), stroke(if e then Theme.outline:Lerp(t.border, 0.7) else Theme.outline, 1, 0),
		})
		text({ Position = UDim2.fromOffset(0, 8), Size = UDim2.new(1, 0, 0, 30), Text = b.emoji, TextSize = 24, TextTransparency = if e then 0 else 0.75, Parent = tile })
		text({
			Position = UDim2.fromOffset(6, 40), Size = UDim2.new(1, -12, 0, 34), Text = spaced(b.label), TextWrapped = true, TextSize = 10, FontFace = Theme.fontSemi,
			TextColor3 = if e then Theme.prose else Theme.prose3, Parent = tile,
		})
		text({
			Position = UDim2.fromOffset(0, 78), Size = UDim2.new(1, 0, 0, 18), Text = if e then `×{fmt(e[1])}` else spaced("locked"),
			TextSize = if e then 12 else 9.5, FontFace = if e then Theme.monoBold else Theme.fontBold, TextColor3 = if e then Theme.epText else Theme.prose3, Parent = tile,
		})
		tile.MouseEnter:Connect(function() tile.BackgroundColor3 = Theme.surfaceRaised end)
		tile.MouseLeave:Connect(function() tile.BackgroundColor3 = Theme.surface end)
		tile.Activated:Connect(function() openBadgeModal(b.id) end)
	end
end

---------------------------------------------------------------------- classement
local boards = nil
local lbTab = "today"
local MEDALS = { "🥇", "🥈", "🥉" }

local function renderLeaderboard()
	local page, col = openPage("leaderboard")
	local o = counter()
	spacer(col, 20, o())
	pageTitle(col, "Leaderboard", o())
	local tabs = frame({ Size = UDim2.new(1, 0, 0, 36), LayoutOrder = o(), Parent = col }, { list(H, 8, LEFT, MIDDLE) })
	local tabButtons = {}
	for i, def in { { "today", "Today" }, { "allTime", "All-time" } } do
		tabButtons[def[1]] = tbutton({ AutomaticSize = AUTO_XY, Text = spaced(def[2]), TextSize = 11.5, BackgroundColor3 = Theme.surface, BackgroundTransparency = 0, LayoutOrder = i, Parent = tabs }, {
			corner(7), stroke(Theme.outline), padding(9, 14),
		})
	end
	local note = text({ Size = UDim2.new(1, 0, 0, 0), AutomaticSize = AUTO_Y, Text = "", TextSize = 12, TextColor3 = Theme.prose3, TextWrapped = true, TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = o(), Parent = col }, {
		padding(10, 0, 12, 0),
	})
	local rowsFrame = frame({ Size = UDim2.new(1, 0, 0, 0), AutomaticSize = AUTO_Y, LayoutOrder = o(), Parent = col }, { list(V, 6) })

	local function render()
		for key, b in tabButtons do
			b.BackgroundColor3 = if lbTab == key then Theme.surfaceRaised else Theme.surface
			b.TextColor3 = if lbTab == key then Theme.prose else Theme.prose2
		end
		for _, c in rowsFrame:GetChildren() do
			if c:IsA("GuiObject") then c:Destroy() end
		end
		if not boards then
			note.Text = "Loading…"
			return
		end
		note.Text = if boards.source == "server" then "⚠ This server only — DataStores are unavailable (in Studio, enable “Studio Access to API Services” to test the global board)."
			elseif lbTab == "today" then "Everyone's best single roll today (UTC). Rolls are unlimited, so it ranks your best roll, not your total. Refreshes every minute."
			else "Everyone's best single roll of all time. Refreshes every minute."
		local entries = if lbTab == "today" then boards.today else boards.allTime
		if #entries == 0 then
			text({ Size = UDim2.new(1, 0, 0, 60), Text = "No rolls yet — be the first!", TextSize = 14, TextColor3 = Theme.prose3, Parent = rowsFrame })
			return
		end
		for i, e in entries do
			local tier = Engine.cardTier(e.ep)
			local mine = e.userId == player.UserId
			local row = frame({ Size = UDim2.new(1, 0, 0, 48), BackgroundColor3 = if mine then Theme.surfaceRaised else Theme.surface, BackgroundTransparency = 0, LayoutOrder = i, Parent = rowsFrame }, {
				corner(8), stroke(if mine then Theme.outlineStrong else Theme.outline),
			})
			local leftSide = frame({ Size = UDim2.new(1, -150, 1, 0), Parent = row }, { list(H, 10, LEFT, MIDDLE), padding(0, 0, 0, 12) })
			text({ Size = UDim2.fromOffset(34, 24), Text = MEDALS[i] or `#{i}`, TextSize = if MEDALS[i] then 20 else 13, FontFace = Theme.monoBold, TextColor3 = Theme.prose3, LayoutOrder = 1, Parent = leftSide })
			text({ Size = UDim2.fromOffset(150, 24), Text = e.name, TextSize = 14, FontFace = Theme.fontBold, TextTruncate = Enum.TextTruncate.AtEnd, TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 2, Parent = leftSide })
			local chip = numCard(tostring(e.n), tier, 16, 1, 8)
			chip.LayoutOrder = 3
			chip.Parent = leftSide
			local pill = tierPill(tier)
			pill.LayoutOrder = 4
			pill.Parent = leftSide
			text({ AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, -14, 0, 0), Size = UDim2.new(0, 140, 1, 0), Text = fmt(e.ep) .. " EP", TextSize = 14, FontFace = Theme.monoBold, TextXAlignment = Enum.TextXAlignment.Right, Parent = row })
		end
	end
	for key, b in tabButtons do
		b.Activated:Connect(function()
			lbTab = key
			render()
		end)
	end
	render()
	local conn = boardValue.Changed:Connect(render)
	page.onClose = function() conn:Disconnect() end
end

local function onBoards()
	local ok, data = pcall(HttpService.JSONDecode, HttpService, boardValue.Value)
	if ok and type(data) == "table" then boards = data end
end
boardValue.Changed:Connect(onBoards)
onBoards()

---------------------------------------------------------------------- navigation et tirage
local PAGES = { home = renderHome, history = renderHistory, stats = renderStats, badges = renderBadges, leaderboard = renderLeaderboard }

function navigate(name)
	if isLocked() then return end
	closeModal()
	PAGES[name]()
end

local function applyToProfile(res)
	local a = Engine.analyze(res.n)
	local t = os.time()
	table.insert(profile.rolls, { res.n, res.total, t })
	profile.rollCount = res.rollNumber
	profile.lifetimeEP = res.lifetimeBefore + res.total
	if not profile.best or res.total > profile.best[2] then profile.best = { res.n, res.total, t } end
	for _, b in a.earned do
		local e = profile.badges[b.id]
		if e then e[1] += 1 else profile.badges[b.id] = { 1, res.n, t } end
	end
	profile.saving = res.saving
end

function startRoll()
	if isLocked() then return end
	rolling = true
	refreshNav()
	local ok, res = pcall(RollFn.InvokeServer, RollFn)
	rolling = false
	if not ok or type(res) ~= "table" then
		toast("Roll failed — try again")
		refreshNav()
		return
	end
	if not res.ok then
		toast(if res.reason == "loading" then "Loading your save…" else "Hold on — the last roll is still revealing")
		refreshNav()
		return
	end
	applyToProfile(res)
	playReveal(res)
end

-- Espace (comme le site), R ou X à la manette ; ignoré pendant la saisie dans le chat ou une zone de texte.
ContextActionService:BindActionAtPriority("RNGRoll", function(_, state)
	if state ~= Enum.UserInputState.Begin then return Enum.ContextActionResult.Pass end
	if modal.Visible then return Enum.ContextActionResult.Pass end
	startRoll()
	return Enum.ContextActionResult.Sink
end, false, Enum.ContextActionPriority.High.Value, Enum.KeyCode.Space, Enum.KeyCode.R, Enum.KeyCode.ButtonX)

---------------------------------------------------------------------- fil du serveur (tirages des autres joueurs)
local feed = frame({ Name = "Feed", AnchorPoint = Vector2.new(1, 1), Position = UDim2.new(1, -14, 1, -14), Size = UDim2.fromOffset(250, 0), AutomaticSize = AUTO_Y, ZIndex = 30, Parent = root }, {
	list(V, 6, RIGHT, Enum.VerticalAlignment.Bottom),
})
local feedOrder = 0
FeedEvent.OnClientEvent:Connect(function(e)
	local t = Theme.tier[e.tier]
	feedOrder += 1
	local item = text({
		Size = UDim2.fromOffset(250, 0), AutomaticSize = AUTO_Y, BackgroundColor3 = Theme.surfaceDim, BackgroundTransparency = 0.05, RichText = true, TextWrapped = true,
		TextXAlignment = Enum.TextXAlignment.Left, TextSize = 12, TextColor3 = Theme.prose2, LayoutOrder = feedOrder, Parent = feed,
		Text = `<b>{e.name}</b> rolled <font face="RobotoMono" color="#f0f0f0"><b>{e.n}</b></font>\n<font color="#{t.text:ToHex()}"><b>{string.upper(e.tier)}</b></font> · {fmt(e.ep)} EP`,
	}, { corner(8), stroke(Theme.outline:Lerp(t.border, 0.6)), padding(6, 10) })
	local items = {}
	for _, c in feed:GetChildren() do
		if c:IsA("TextLabel") then table.insert(items, c) end
	end
	table.sort(items, function(x, y) return x.LayoutOrder > y.LayoutOrder end)
	for i = 5, #items do
		items[i]:Destroy()
	end
	task.delay(20, function()
		if item.Parent then
			tween(item, 0.6, { TextTransparency = 1, BackgroundTransparency = 1 }).Completed:Connect(function() item:Destroy() end)
		end
	end)
	if TIER_RANK[e.tier] >= TIER_RANK.epic and e.userId ~= player.UserId then
		local channels = TextChatService:FindFirstChild("TextChannels")
		local system = channels and channels:FindFirstChild("RBXSystem")
		if system then
			system:DisplaySystemMessage(`<font color="#{t.text:ToHex()}">🎲 {e.name} rolled {e.n} — {string.upper(e.tier)} ({fmt(e.ep)} EP)</font>`)
		end
	end
end)

NoticeEvent.OnClientEvent:Connect(toast)

---------------------------------------------------------------------- démarrage
renderHome()
task.spawn(function()
	for _ = 1, 30 do
		local ok, p = pcall(ProfileFn.InvokeServer, ProfileFn)
		if ok and p then
			profile = p
			if currentPage and currentPage.name == "home" and not session then renderHome() end
			return
		end
		task.wait(1)
	end
end)

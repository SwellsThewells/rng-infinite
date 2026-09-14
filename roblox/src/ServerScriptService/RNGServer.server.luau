--[[
	RNG∞ — serveur : tirages, profils (DataStore avec verrou de session), classements du meilleur tirage (jour / all-time),
	game passes, succès et badges Roblox, série de jours, annonce des tirages Mythic sur tous les serveurs.
	Le nombre est tiré et scoré ici ; le client ne fait qu'animer le résultat.
	Le résultat n'est rendu public (leaderstats, fil, classement, annonce, badges Roblox)
	qu'une fois la rareté affichée chez le joueur, pour ne pas lui gâcher sa révélation.
]]
local Players = game:GetService("Players")
local DataStoreService = game:GetService("DataStoreService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")
local MarketplaceService = game:GetService("MarketplaceService")
local BadgeService = game:GetService("BadgeService")
local MessagingService = game:GetService("MessagingService")

-- Jeu 100 % interface, comme le site : pas de personnage.
Players.CharacterAutoLoads = false

local RNG = ReplicatedStorage:WaitForChild("RNG")
local Engine = require(RNG.Engine)
local Timing = require(RNG.Timing)
local Shop = require(RNG.Shop)

local HISTORY_CAP = 3000 -- tirages gardés dans la sauvegarde (compteurs et EP à vie restent exacts au-delà)
local LEADERBOARD_SIZE = 10
local LEADERBOARD_REFRESH = 60
local AUTOSAVE = 60 -- sauvegarde et rafraîchit le verrou de session
local LOCK_TTL = 300 -- s : un verrou plus vieux est considéré abandonné (serveur planté)
local EP_SCALE = 1e7 -- valeur classée = EP × 1e7 + nombre (EP max 186 186 584 → < 2^53)
local ROLL_GRACE = 0.75 -- tolérance réseau sur l'attente entre deux tirages (s)
local ANNOUNCE_TOPIC = "RNGInfinite_Mythic"
local TIER_ACHIEVEMENTS = { { "rare", "FIRST_RARE" }, { "epic", "FIRST_EPIC" }, { "anomaly", "FIRST_ANOMALY" }, { "mythic", "FIRST_MYTHIC" } }

-- Change quand la liste ou les scores des badges changent : les EP sauvegardés sont alors recalculés.
local SCORE_VERSION = (function()
	local acc = 0
	for i, b in Engine.badges do
		acc = (acc * 31 + b.score + i) % 2147483647
	end
	return `{#Engine.badges}:{acc}`
end)()

---------------------------------------------------------------------- remotes
local remotes = Instance.new("Folder")
remotes.Name = "RNGRemotes"
local function remote(class, name)
	local r = Instance.new(class)
	r.Name = name
	r.Parent = remotes
	return r
end
local RollFn = remote("RemoteFunction", "Roll")
local ProfileFn = remote("RemoteFunction", "GetProfile")
local SetSkinFn = remote("RemoteFunction", "SetSkin")
local FeedEvent = remote("RemoteEvent", "Feed")
local NoticeEvent = remote("RemoteEvent", "Notice")
local boardValue = remote("StringValue", "Leaderboards")
remotes.Parent = ReplicatedStorage

---------------------------------------------------------------------- DataStores
local playerStore = DataStoreService:GetDataStore("RNGInfinite_Players_v1")
local allTimeStore = DataStoreService:GetOrderedDataStore("RNGInfinite_BestAllTime_v1")
local function dayKey(t)
	return os.date("!%Y%m%d", t or os.time())
end
local function dailyStore(day)
	return DataStoreService:GetOrderedDataStore("RNGInfinite_BestDaily_v1", day)
end

local function retry(fn, attempts)
	local lastErr
	for i = 1, attempts or 3 do
		local ok, res = pcall(fn)
		if ok then return true, res end
		lastErr = res
		if i < (attempts or 3) then task.wait(i * 1.5) end
	end
	return false, lastErr
end

-- En Studio sans « Enable Studio Access to API Services », tout tourne en mémoire (rien n'est sauvegardé).
local storesOk = true
if RunService:IsStudio() then
	local ok, err = pcall(function()
		return playerStore:GetAsync("probe")
	end)
	if not ok then
		storesOk = false
		warn("[RNG∞] DataStore indisponible dans Studio, parties non sauvegardées : " .. tostring(err))
	end
end

---------------------------------------------------------------------- game passes (attributs Pass_<clé> posés sur le joueur)
local function ownsPass(player, key)
	return player:GetAttribute("Pass_" .. key) == true
end

local function refreshPasses(player)
	for _, pass in Shop.passes do
		if pass.id == 0 then continue end
		local ok, owned = pcall(MarketplaceService.UserOwnsGamePassAsync, MarketplaceService, player.UserId, pass.id)
		if ok and owned then player:SetAttribute("Pass_" .. pass.key, true) end
	end
end

MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(player, passId, purchased)
	if not purchased then return end
	for _, pass in Shop.passes do
		if pass.id ~= 0 and pass.id == passId then player:SetAttribute("Pass_" .. pass.key, true) end
	end
end)

local vipCache = {}
local function isVip(userId)
	local p = Players:GetPlayerByUserId(userId)
	if p then return ownsPass(p, "VIP") end
	local vip = Shop.byKey.VIP
	if vip.id == 0 then return false end
	if vipCache[userId] == nil then
		local ok, owned = pcall(MarketplaceService.UserOwnsGamePassAsync, MarketplaceService, userId, vip.id)
		vipCache[userId] = ok and owned == true
	end
	return vipCache[userId]
end

---------------------------------------------------------------------- profils
-- data = { v, scoreVersion, rolls = {{n, ep, t}}, rollCount, lifetimeEP, best = {n, ep, t}, daily = {day, n, ep},
--          badges = {[id] = {count, firstN, firstT}}, ach = {[clé] = t}, streak = {day, count, best}, skin, lock = {job, t} }
local profiles = {}
local sessionBest = {} -- [userId] = { name, n, ep } : classement du serveur quand les DataStores sont indisponibles

local function newData()
	return { v = 1, scoreVersion = SCORE_VERSION, rolls = {}, rollCount = 0, lifetimeEP = 0, badges = {}, ach = {}, skin = "default" }
end

local function migrate(data)
	data.rolls = data.rolls or {}
	data.rollCount = data.rollCount or #data.rolls
	data.lifetimeEP = data.lifetimeEP or 0
	data.badges = data.badges or {}
	data.ach = data.ach or {}
	data.skin = data.skin or "default"
	return data
end

local function rescore(data)
	if data.scoreVersion == SCORE_VERSION then return end
	local delta = 0
	for _, r in data.rolls do
		local ep = Engine.scoreOf(r[1])
		delta += ep - r[2]
		r[2] = ep
	end
	data.lifetimeEP += delta
	data.best = nil
	for _, r in data.rolls do
		if not data.best or r[2] > data.best[2] then data.best = { r[1], r[2], r[3] } end
	end
	if data.daily then
		data.daily.ep = Engine.scoreOf(data.daily.n)
	end
	data.scoreVersion = SCORE_VERSION
end

local function refreshStats(player, prof)
	local ls = player:FindFirstChild("leaderstats")
	if not ls then return end
	ls["Best EP"].Value = if prof.data.best then prof.data.best[2] else 0
	ls.Rolls.Value = prof.data.rollCount
end

-- Série de jours (UTC) avec au moins un tirage.
local function updateStreak(data, t)
	local today = dayKey(t)
	local st = data.streak
	if st and st.day == today then return end
	local count = if st and st.day == dayKey(t - 86400) then st.count + 1 else 1
	data.streak = { day = today, count = count, best = math.max(count, if st then st.best or st.count else 0) }
end

-- Série affichée : 0 si le dernier jour joué n'est ni aujourd'hui ni hier.
local function streakView(data)
	local st = data.streak
	if not st then return { count = 0, best = 0 } end
	local now = os.time()
	local alive = st.day == dayKey(now) or st.day == dayKey(now - 86400)
	return { count = if alive then st.count else 0, best = st.best or st.count }
end

-- Succès atteints et pas encore débloqués. La date est posée ici ; le badge Roblox est décerné par l'appelant.
local function checkAchievements(data)
	local new = {}
	local function grant(key)
		if data.ach[key] then return end
		data.ach[key] = os.time()
		table.insert(new, key)
	end
	if data.rollCount >= 1 then grant("FIRST_ROLL") end
	if data.rollCount >= 100 then grant("ROLLS_100") end
	if data.rollCount >= 1000 then grant("ROLLS_1000") end
	if data.best then
		local rank = Engine.TIER_RANK[Engine.cardTier(data.best[2])]
		for _, pair in TIER_ACHIEVEMENTS do
			if rank >= Engine.TIER_RANK[pair[1]] then grant(pair[2]) end
		end
	end
	local collected = 0
	for _ in data.badges do
		collected += 1
	end
	if collected >= 50 then grant("COLLECT_50") end
	if collected >= 150 then grant("COLLECT_150") end
	local streak = if data.streak then data.streak.count else 0
	if streak >= 7 then grant("STREAK_7") end
	if streak >= 30 then grant("STREAK_30") end
	return new
end

local function awardBadges(player, keys)
	for _, key in keys do
		local def = Shop.achievementsByKey[key]
		if def and def.badge ~= 0 then
			task.spawn(pcall, BadgeService.AwardBadge, BadgeService, player.UserId, def.badge)
		end
	end
end

local function skinUnlocked(player, data, key)
	local skin = Shop.skinsByKey[key]
	if not skin then return false end
	if key == "default" then return true end
	if skin.pass and ownsPass(player, skin.pass) then return true end
	return skin.achievement ~= nil and data.ach[skin.achievement] ~= nil
end

---------------------------------------------------------------------- classements
local nameCache = {}
local function nameOf(userId)
	if nameCache[userId] then return nameCache[userId] end
	local p = Players:GetPlayerByUserId(userId)
	if p then
		nameCache[userId] = p.Name
		return p.Name
	end
	local ok, name = pcall(Players.GetNameFromUserIdAsync, Players, userId)
	nameCache[userId] = if ok then name else `#{userId}`
	return nameCache[userId]
end

local function readBoard(store)
	local ok, pages = retry(function()
		return store:GetSortedAsync(false, LEADERBOARD_SIZE)
	end, 2)
	if not ok then return nil end
	local out = {}
	for _, entry in pages:GetCurrentPage() do
		local ep = math.floor(entry.value / EP_SCALE)
		local userId = tonumber(entry.key)
		table.insert(out, { userId = userId, name = nameOf(userId), n = entry.value - ep * EP_SCALE, ep = ep, vip = isVip(userId) })
	end
	return out
end

local lastBoards = { allTime = {}, today = {} }
local function refreshBoards()
	local data = { day = dayKey(), updated = os.time() }
	if storesOk then
		data.source = "global"
		data.allTime = readBoard(allTimeStore) or lastBoards.allTime
		data.today = readBoard(dailyStore(data.day)) or (if lastBoards.day == data.day then lastBoards.today else {})
	else
		data.source = "server"
		local list = {}
		for userId, e in sessionBest do
			table.insert(list, { userId = userId, name = e.name, n = e.n, ep = e.ep, vip = isVip(userId) })
		end
		table.sort(list, function(a, b) return a.ep > b.ep end)
		data.allTime = {}
		for i = 1, math.min(#list, LEADERBOARD_SIZE) do
			data.allTime[i] = list[i]
		end
		data.today = data.allTime
	end
	lastBoards = data
	boardValue.Value = HttpService:JSONEncode(data)
end

local function submitBest(store, userId, n, ep)
	local value = ep * EP_SCALE + n
	task.spawn(function()
		local ok, err = retry(function()
			store:UpdateAsync(tostring(userId), function(old)
				if old and old >= value then return nil end
				return value
			end)
		end, 3)
		if not ok then warn("[RNG∞] classement non mis à jour : " .. tostring(err)) end
	end)
end

---------------------------------------------------------------------- sauvegarde (verrou de session)
-- Un serveur pose { job, t } dans la sauvegarde en la chargeant. Un autre serveur attend que le verrou soit rendu
-- (ou périmé) avant de charger, et n'écrase jamais une sauvegarde verrouillée par quelqu'un d'autre.
local function loadWithLock(player)
	local key = "u_" .. player.UserId
	for attempt = 1, 6 do
		local blocked = false
		local ok, res = pcall(function()
			return playerStore:UpdateAsync(key, function(old)
				blocked = false
				local locked = type(old) == "table" and type(old.lock) == "table" and old.lock.job ~= game.JobId
					and os.time() - (old.lock.t or 0) < LOCK_TTL
				if locked and attempt < 6 then
					blocked = true
					return nil
				end
				local data = if type(old) == "table" then old else newData()
				data.lock = { job = game.JobId, t = os.time() }
				return data
			end)
		end)
		if ok and not blocked then return true, res end
		if not ok then warn(`[RNG∞] chargement de {player.Name}, essai {attempt} : {res}`) end
		if not player.Parent then return false end
		task.wait(if blocked then 5 else attempt * 1.5)
	end
	return false
end

-- mode : nil = seulement si modifié ; "refresh" = rafraîchit aussi le verrou ; "release" = dernière écriture, rend le verrou.
local function save(player, prof, mode)
	if not storesOk or not prof.canSave then return end
	if not (prof.dirty or mode) then return end
	prof.dirty = false
	local lost = false
	local ok, err = retry(function()
		playerStore:UpdateAsync("u_" .. player.UserId, function(old)
			lost = type(old) == "table" and type(old.lock) == "table" and old.lock.job ~= game.JobId
			if lost then return nil end
			prof.data.lock = if mode == "release" then nil else { job = game.JobId, t = os.time() }
			return prof.data
		end)
	end, 3)
	if lost then
		prof.canSave = false
		warn(`[RNG∞] {player.Name} est actif sur un autre serveur : sauvegarde ignorée`)
	elseif not ok then
		prof.dirty = true
		warn(`[RNG∞] sauvegarde échouée pour {player.Name} : {err}`)
	end
end

local function onPlayerAdded(player)
	local ls = Instance.new("Folder")
	ls.Name = "leaderstats"
	local best = Instance.new("IntValue")
	best.Name = "Best EP"
	best.Parent = ls
	local rolls = Instance.new("IntValue")
	rolls.Name = "Rolls"
	rolls.Parent = ls
	ls.Parent = player

	local prof = { data = newData(), ready = false, dirty = false, canSave = storesOk, nextRollAt = 0 }
	profiles[player] = prof
	refreshPasses(player)

	if storesOk then
		local ok, res = loadWithLock(player)
		if ok and type(res) == "table" then
			prof.data = res
		else
			prof.canSave = false
			NoticeEvent:FireClient(player, "Your save couldn't be loaded — rolls this session won't be saved.")
			warn(`[RNG∞] chargement impossible pour {player.Name}`)
		end
	end
	if profiles[player] ~= prof then
		-- Parti pendant le chargement : on rend le verrou qu'on vient de poser.
		if storesOk and prof.canSave then task.spawn(save, player, prof, "release") end
		return
	end
	local data = migrate(prof.data)
	rescore(data)
	checkAchievements(data)
	local held = {}
	for key in data.ach do
		table.insert(held, key)
	end
	awardBadges(player, held) -- rattrape les badges Roblox créés après coup
	if not skinUnlocked(player, data, data.skin) then data.skin = "default" end
	if data.best then
		sessionBest[player.UserId] = { name = player.Name, n = data.best[1], ep = data.best[2] }
	end
	prof.ready = true
	refreshStats(player, prof)
	if not storesOk then refreshBoards() end
end

local function onPlayerRemoving(player)
	local prof = profiles[player]
	if not prof then return end
	profiles[player] = nil
	if prof.ready then save(player, prof, "release") end
end

---------------------------------------------------------------------- tirage
RollFn.OnServerInvoke = function(player)
	local prof = profiles[player]
	if not prof or not prof.ready then return { ok = false, reason = "loading" } end
	local now = os.clock()
	if now < prof.nextRollAt then return { ok = false, reason = "cooldown", wait = prof.nextRollAt - now } end

	local n = Engine.roll()
	local a = Engine.analyze(n)
	local data = prof.data
	local t = os.time()
	local isFirst = data.rollCount == 0
	local speed = if ownsPass(player, "FAST_ROLL") then "fast" else "normal"

	-- Nouveaux badges et nombre déjà tiré (dans l'historique conservé), comme les notes du site.
	local newIds = {}
	for _, b in a.earned do
		local e = data.badges[b.id]
		if e then
			e[1] += 1
		else
			data.badges[b.id] = { 1, n, t }
			if not isFirst then table.insert(newIds, b.id) end
		end
	end
	local repeats, lastRepeat = 0, nil
	for i, r in data.rolls do
		if r[1] == n then
			repeats += 1
			lastRepeat = { index = data.rollCount - #data.rolls + i, t = r[3] }
		end
	end

	local lifetimeBefore = data.lifetimeEP
	table.insert(data.rolls, { n, a.total, t })
	if #data.rolls > HISTORY_CAP then table.remove(data.rolls, 1) end
	data.rollCount += 1
	data.lifetimeEP += a.total
	local improvedAllTime = not data.best or a.total > data.best[2]
	if improvedAllTime then data.best = { n, a.total, t } end
	local day = dayKey(t)
	local improvedToday = not data.daily or data.daily.day ~= day or a.total > data.daily.ep
	if improvedToday then data.daily = { day = day, n = n, ep = a.total } end
	updateStreak(data, t)
	local unlocked = checkAchievements(data)
	prof.dirty = true

	local schedule = Timing.schedule(math.max(6, #a.str), #a.groups, speed)
	prof.nextRollAt = now + schedule.rarity - ROLL_GRACE

	-- Rendu public une fois la rareté révélée chez le joueur.
	task.delay(schedule.rarity, function()
		if not player.Parent then return end
		refreshStats(player, prof)
		awardBadges(player, unlocked)
		local entry = { userId = player.UserId, name = player.DisplayName, n = n, ep = a.total, tier = a.tier, vip = ownsPass(player, "VIP") }
		FeedEvent:FireAllClients(entry)
		if a.tier == "mythic" then
			entry.job = game.JobId
			task.spawn(pcall, MessagingService.PublishAsync, MessagingService, ANNOUNCE_TOPIC, entry)
		end
		if storesOk then
			if improvedAllTime then submitBest(allTimeStore, player.UserId, n, a.total) end
			if improvedToday then submitBest(dailyStore(day), player.UserId, n, a.total) end
		elseif improvedAllTime then
			sessionBest[player.UserId] = { name = player.Name, n = n, ep = a.total }
			refreshBoards()
		end
	end)

	return {
		ok = true,
		n = n,
		total = a.total,
		rollNumber = data.rollCount,
		lifetimeBefore = lifetimeBefore,
		isFirst = isFirst,
		newIds = newIds,
		repeats = repeats,
		lastRepeat = lastRepeat,
		speed = speed,
		streak = streakView(data),
		achievements = unlocked,
		saving = storesOk and prof.canSave,
	}
end

SetSkinFn.OnServerInvoke = function(player, key)
	local prof = profiles[player]
	if not prof or not prof.ready or type(key) ~= "string" then return false end
	if not skinUnlocked(player, prof.data, key) then return false end
	prof.data.skin = key
	prof.dirty = true
	return true
end

ProfileFn.OnServerInvoke = function(player)
	local prof = profiles[player]
	if not prof or not prof.ready then return nil end
	local d = prof.data
	return {
		rolls = d.rolls,
		rollCount = d.rollCount,
		lifetimeEP = d.lifetimeEP,
		best = d.best,
		badges = d.badges,
		ach = d.ach,
		skin = d.skin,
		streak = streakView(d),
		saving = storesOk and prof.canSave,
	}
end

---------------------------------------------------------------------- annonces inter-serveurs (tirages Mythic)
task.spawn(function()
	local ok, err = pcall(function()
		MessagingService:SubscribeAsync(ANNOUNCE_TOPIC, function(message)
			local e = message.Data
			if type(e) ~= "table" or e.job == game.JobId then return end
			e.global = true
			e.job = nil
			FeedEvent:FireAllClients(e)
		end)
	end)
	if not ok then warn("[RNG∞] annonces inter-serveurs indisponibles : " .. tostring(err)) end
end)

---------------------------------------------------------------------- boucle
Players.PlayerAdded:Connect(onPlayerAdded)
Players.PlayerRemoving:Connect(onPlayerRemoving)
for _, p in Players:GetPlayers() do
	task.spawn(onPlayerAdded, p)
end

task.spawn(function()
	while true do
		refreshBoards()
		task.wait(LEADERBOARD_REFRESH)
	end
end)

task.spawn(function()
	while true do
		task.wait(AUTOSAVE)
		for player, prof in profiles do
			if prof.ready then task.spawn(save, player, prof, "refresh") end
		end
	end
end)

game:BindToClose(function()
	local pending = 0
	for player, prof in profiles do
		if not prof.ready then continue end
		pending += 1
		task.spawn(function()
			save(player, prof, "release")
			pending -= 1
		end)
	end
	local deadline = os.clock() + 25
	while pending > 0 and os.clock() < deadline do
		task.wait(0.2)
	end
end)

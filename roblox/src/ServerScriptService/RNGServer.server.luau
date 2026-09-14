--[[
	RNG∞ — serveur : tirages, profils (DataStore), classements du meilleur tirage (jour / all-time), annonces.
	Le nombre est tiré et scoré ici ; le client ne fait qu'animer le résultat.
	Le résultat n'est rendu public (leaderstats, fil du serveur, classement)
	qu'une fois la rareté affichée chez le joueur, pour ne pas lui gâcher sa révélation.
]]
local Players = game:GetService("Players")
local DataStoreService = game:GetService("DataStoreService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")

-- Jeu 100 % interface, comme le site : pas de personnage.
Players.CharacterAutoLoads = false

local RNG = ReplicatedStorage:WaitForChild("RNG")
local Engine = require(RNG.Engine)
local Timing = require(RNG.Timing)

local HISTORY_CAP = 3000 -- tirages gardés dans la sauvegarde (compteurs et EP à vie restent exacts au-delà)
local LEADERBOARD_SIZE = 10
local LEADERBOARD_REFRESH = 60
local AUTOSAVE = 90
local EP_SCALE = 1e7 -- valeur classée = EP × 1e7 + nombre (EP max 186 186 584 → < 2^53)
local ROLL_GRACE = 0.75 -- tolérance réseau sur l'attente entre deux tirages (s)

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

---------------------------------------------------------------------- profils
-- data = { v, scoreVersion, rolls = {{n, ep, t}}, rollCount, lifetimeEP, best = {n, ep, t}, daily = {day, n, ep}, badges = {[id] = {count, firstN, firstT}} }
local profiles = {}
local sessionBest = {} -- [userId] = { name, n, ep } : classement du serveur quand les DataStores sont indisponibles

local function newData()
	return { v = 1, scoreVersion = SCORE_VERSION, rolls = {}, rollCount = 0, lifetimeEP = 0, best = nil, daily = nil, badges = {} }
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
		table.insert(out, { userId = userId, name = nameOf(userId), n = entry.value - ep * EP_SCALE, ep = ep })
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
			table.insert(list, { userId = userId, name = e.name, n = e.n, ep = e.ep })
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

---------------------------------------------------------------------- sauvegarde
local function save(player, prof, force)
	if not storesOk or not prof.canSave or not (prof.dirty or force) then return end
	prof.dirty = false
	local ok, err = retry(function()
		playerStore:UpdateAsync("u_" .. player.UserId, function()
			return prof.data
		end)
	end, 3)
	if not ok then
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

	if storesOk then
		local ok, res = retry(function()
			return playerStore:GetAsync("u_" .. player.UserId)
		end, 3)
		if ok then
			if type(res) == "table" then prof.data = res end
		else
			prof.canSave = false
			NoticeEvent:FireClient(player, "Your save couldn't be loaded — rolls this session won't be saved.")
			warn(`[RNG∞] chargement échoué pour {player.Name} : {res}`)
		end
	end
	if profiles[player] ~= prof then return end -- parti pendant le chargement
	rescore(prof.data)
	local b = prof.data.best
	if b then
		sessionBest[player.UserId] = { name = player.Name, n = b[1], ep = b[2] }
	end
	prof.ready = true
	refreshStats(player, prof)
	if not storesOk then refreshBoards() end
end

local function onPlayerRemoving(player)
	local prof = profiles[player]
	if not prof then return end
	save(player, prof)
	profiles[player] = nil
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
	prof.dirty = true

	local schedule = Timing.schedule(math.max(6, #a.str), #a.groups)
	prof.nextRollAt = now + schedule.rarity - ROLL_GRACE

	-- Rendu public une fois la rareté révélée chez le joueur.
	task.delay(schedule.rarity, function()
		if not player.Parent then return end
		refreshStats(player, prof)
		FeedEvent:FireAllClients({ userId = player.UserId, name = player.DisplayName, n = n, ep = a.total, tier = a.tier })
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
		saving = storesOk and prof.canSave,
	}
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
		saving = storesOk and prof.canSave,
	}
end

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
			task.spawn(save, player, prof)
		end
	end
end)

game:BindToClose(function()
	local pending = 0
	for player, prof in profiles do
		pending += 1
		task.spawn(function()
			save(player, prof, true)
			pending -= 1
		end)
	end
	local deadline = os.clock() + 25
	while pending > 0 and os.clock() < deadline do
		task.wait(0.2)
	end
end)

--[[
	Validation du port Luau contre le moteur JS (hash attendus générés par tools/roblox.mjs).
	À exécuter dans Studio en mode Edit (execute_luau / barre de commande), puis lire
	ServerStorage.RNGValidation : attributs progress, done, report.
	Nécessite ServerStorage.RNGTests.Expected (copie de roblox/tests/Expected.luau).

	Vérifie :
	1. les 1 000 001 nombres (total EP, rareté, « Top x % », groupes de badges) — hash par bloc de 10 000
	2. le score de chaque badge d'origine redérivé de sa fréquence (100 × 1 000 001 / nb) — 233/233
	3. un échantillon de 20 015 nombres : chiffres surlignés + ligne de détail, et scoreOf == analyze
]]
local SS = game:GetService("ServerStorage")
local RS = game:GetService("ReplicatedStorage")

-- Copies fraîches : require garde les modules en cache, on veut tester la source actuelle.
local folder = RS.RNG:Clone()
folder.Name = "RNG_validate"
folder.Parent = SS
local expectedModule = SS.RNGTests.Expected:Clone()
expectedModule.Parent = folder
local Engine = require(folder.Engine)
local Expected = require(expectedModule)

local status = SS:FindFirstChild("RNGValidation") or Instance.new("Configuration")
status.Name = "RNGValidation"
status:SetAttribute("progress", "démarrage")
status:SetAttribute("done", false)
status:SetAttribute("report", "")
status.Parent = SS

local MOD = 2147483647
local function mix(h, v)
	return (h * 31 + v) % MOD
end

-- Rend la main à Studio toutes les 50 ms de calcul.
local sliceStart = os.clock()
local function maybeYield()
	if os.clock() - sliceStart > 0.05 then
		task.wait()
		sliceStart = os.clock()
	end
end

task.spawn(function()
	local ok, err = pcall(function()
		local t0 = os.clock()
		local counts = table.create(#Engine.badges, 0)
		local badBlocks = {}
		for block = 0, 100 do
			local h = 0
			for n = block * 10000, math.min(block * 10000 + 9999, 1000000) do
				local a = Engine.analyze(n)
				local kind, v, bucket = Engine.labelKey(a.percentile)
				h = mix(h, n)
				h = mix(h, a.total)
				h = mix(h, Engine.TIER_RANK[a.tier])
				h = mix(h, kind)
				h = mix(h, v)
				h = mix(h, bucket)
				h = mix(h, #a.groups)
				for _, g in a.groups do
					h = mix(h, g.badge.index)
					h = mix(h, #g.subsidiary)
					for _, sb in g.subsidiary do
						h = mix(h, sb.index)
					end
				end
				for _, b in a.earned do
					counts[b.index] += 1
				end
				maybeYield()
			end
			if h ~= Expected.blocks[block + 1] then table.insert(badBlocks, block) end
			status:SetAttribute("progress", `bloc {block}/100 · {math.floor(os.clock() - t0)} s · {#badBlocks} faux`)
		end

		local scoreBad, original = {}, 0
		for i, b in Engine.badges do
			if Expected.custom[b.id] then continue end
			original += 1
			local derived = if counts[i] > 0 then math.floor(100 * 1000001 / counts[i] + 0.5) else math.huge
			if derived ~= b.score then table.insert(scoreBad, `{b.id}:{derived}/{b.score}`) end
		end

		local sample = {}
		for n = 0, 9999 do
			table.insert(sample, n)
		end
		for i = 1, 10000 do
			table.insert(sample, (i * 99991) % 1000001)
		end
		for _, n in Expected.extra do
			table.insert(sample, n)
		end
		local badSample, scoreMismatch = {}, 0
		local h, blockIdx = 0, 1
		for k, n in sample do
			h = mix(h, n)
			local a = Engine.analyze(n)
			if Engine.scoreOf(n) ~= a.total then scoreMismatch += 1 end
			for _, b in a.earned do
				h = mix(h, b.index)
				local groups = Engine.highlight(b.id, n)
				h = mix(h, #groups)
				for _, g in groups do
					h = mix(h, #g)
					for _, i in g do
						h = mix(h, i)
					end
				end
				local detail = Engine.badgeDetail(b.id, n)
				for j = 1, #detail do
					h = mix(h, string.byte(detail, j))
				end
			end
			if k % 1000 == 0 or k == #sample then
				if h ~= Expected.sampleBlocks[blockIdx] then table.insert(badSample, blockIdx) end
				blockIdx += 1
				h = 0
			end
			maybeYield()
		end

		status:SetAttribute("report", table.concat({
			`nombres : {101 - #badBlocks}/101 blocs conformes` .. (if #badBlocks > 0 then " (faux : " .. table.concat(badBlocks, ",") .. ")" else ""),
			`scores des badges d'origine : {original - #scoreBad}/{original}` .. (if #scoreBad > 0 then " (" .. table.concat(scoreBad, " ") .. ")" else ""),
			`surlignage + détails : {blockIdx - 1 - #badSample}/{blockIdx - 1} blocs conformes` .. (if #badSample > 0 then " (faux : " .. table.concat(badSample, ",") .. ")" else ""),
			`scoreOf ≠ analyze : {scoreMismatch}`,
			`durée : {math.floor(os.clock() - t0)} s`,
		}, "\n"))
	end)
	if not ok then status:SetAttribute("report", "ERREUR : " .. tostring(err)) end
	status:SetAttribute("done", true)
	folder:Destroy()
end)

return "validation lancée"

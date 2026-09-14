--!nonstrict
--[[
	RNG∞ — moteur de badges, port Luau de js/engine.js (version web).
	Les positions de chiffres sont 0-based en interne comme l'original ; highlight() renvoie des positions 1-based.
	Validé contre le moteur JS : tools/roblox.mjs génère les hash attendus, roblox/tests/validate.luau les recalcule dans Studio.
]]

local BadgeMeta = require(script.Parent.BadgeMeta)
local Percentiles = require(script.Parent.Percentiles)

local MAX_ROLL = 1000000
local floor, sqrt, abs = math.floor, math.sqrt, math.abs
local ssub, sfind, sbyte = string.sub, string.find, string.byte

-- Math.round de JS (valeurs positives)
local function round(x)
	return floor(x + 0.5)
end

---------------------------------------------------------------------- helpers numériques
local function isPrime(n)
	if n < 2 then return false end
	if n < 4 then return true end
	if n % 2 == 0 or n % 3 == 0 then return false end
	local i = 5
	while i * i <= n do
		if n % i == 0 or n % (i + 2) == 0 then return false end
		i += 6
	end
	return true
end

local function isSquare(n)
	if n < 0 then return false end
	local r = round(sqrt(n))
	return r * r == n
end

local function isCube(n)
	local r = round(n ^ (1 / 3))
	return r * r * r == n
end

local function isPerfectPower(n, k)
	if n == 0 or n == 1 then return true end
	return round(n ^ (1 / k)) ^ k == n
end

local function isPowerOf(n, base)
	if n <= 0 then return false end
	local p = 1
	while p < n do
		p *= base
	end
	return p == n
end

local function isFibonacci(n)
	return isSquare(5 * n * n + 4) or isSquare(5 * n * n - 4)
end

local function isPronic(n)
	local k = round((sqrt(1 + 4 * n) - 1) / 2)
	return k * (k + 1) == n
end

local function isPalindrome(s)
	local i, j = 1, #s
	while i < j do
		if sbyte(s, i) ~= sbyte(s, j) then return false end
		i += 1
		j -= 1
	end
	return true
end

local FACTORIALS = { [1] = true, [2] = true, [6] = true, [24] = true, [120] = true, [720] = true, [5040] = true, [40320] = true, [362880] = true }
local SELF_POWERS = { [1] = true, [4] = true, [27] = true, [256] = true, [3125] = true, [46656] = true, [823543] = true }

local function hasLeadingZero(p)
	return #p > 1 and sbyte(p, 1) == 48
end

-- [a, b) en positions 0-based
local function range(a, b)
	local out = {}
	for i = a, b - 1 do
		table.insert(out, i)
	end
	return out
end

local function contains(s, x)
	return sfind(s, x, 1, true) ~= nil
end

-- String.indexOf de JS : position 0-based ou -1
local function indexOf(s, x, from)
	local i = sfind(s, x, (from or 0) + 1, true)
	return if i then i - 1 else -1
end

local function indicesOf(s, ch)
	local out, b = {}, sbyte(ch)
	for i = 1, #s do
		if sbyte(s, i) == b then table.insert(out, i - 1) end
	end
	return out
end

local function isRunSet(nums)
	local a = table.clone(nums)
	table.sort(a)
	for i = 2, #a do
		if a[i] - a[i - 1] ~= 1 then return false end
	end
	return true
end

local function isStrictlyMonotonic(nums)
	local up, down = true, true
	for i = 2, #nums do
		if nums[i] <= nums[i - 1] then up = false end
		if nums[i] >= nums[i - 1] then down = false end
	end
	return up or down
end

-- Suite de `len` chiffres adjacents qui montent ou descendent de 1 à chaque pas. Index de départ ou -1.
local function findDigitRun(d, L, len)
	for i = 0, L - len do
		local step = d[i + 1] - d[i]
		if step == 1 or step == -1 then
			local ok = true
			for k = 2, len - 1 do
				if d[i + k] - d[i + k - 1] ~= step then
					ok = false
					break
				end
			end
			if ok then return i end
		end
	end
	return -1
end

-- Tous les chiffres triés forment une suite +1 (donc sans doublon).
local function isScrambledRun(str, minLen)
	if #str < minLen then return false end
	local a = {}
	for i = 1, #str do
		a[i] = sbyte(str, i) - 48
	end
	table.sort(a)
	for i = 2, #a do
		if a[i] ~= a[i - 1] + 1 then return false end
	end
	return true
end

-- Découpe s en k morceaux sans zéro de tête ; premier découpage (ordre lexicographique des coupes) validé par pred.
local function findSplit(s, k, pred)
	local L = #s
	local starts, nums = table.create(k), table.create(k)
	local function rec(part, from)
		if part == k then
			local p = ssub(s, from + 1)
			if hasLeadingZero(p) then return false end
			starts[part] = from
			nums[part] = tonumber(p)
			return pred(nums)
		end
		local remaining = k - part
		for to = from + 1, L - remaining do
			local p = ssub(s, from + 1, to)
			if not hasLeadingZero(p) then
				starts[part] = from
				nums[part] = tonumber(p)
				if rec(part + 1, to) then return true end
			end
		end
		return false
	end
	if not rec(1, 0) then return nil end
	local groups = {}
	for i = 1, k do
		groups[i] = range(starts[i], if i < k then starts[i + 1] else L)
	end
	return { nums = table.clone(nums), groups = groups }
end

local function hasMultiDigit(nums)
	for _, v in nums do
		if v >= 10 then return true end
	end
	return false
end

-- Le nombre entier se découpe en k entiers consécutifs (au moins un morceau à 2+ chiffres).
local function findConsecutiveSplit(s, k)
	return findSplit(s, k, function(nums)
		return hasMultiDigit(nums) and isRunSet(nums)
	end)
end

-- Deux sous-chaînes collées qui sont des entiers consécutifs (sans couvrir tout le nombre).
local function findConsecutivePairAdjacent(s)
	local L = #s
	for t = 0, L - 1 do
		for len = 1, L - t - 1 do
			local a = ssub(s, t + 1, t + len)
			if hasLeadingZero(a) then continue end
			local av = tonumber(a)
			for dir = 1, 2 do
				local bv = if dir == 1 then av + 1 else av - 1
				if bv < 0 then continue end
				local b = tostring(bv)
				local e = t + len + #b
				if e > L or ssub(s, t + len + 1, e) ~= b then continue end
				if #a < 2 and #b < 2 then continue end
				if t == 0 and e == L then continue end
				return { range(t, t + len), range(t + len, e) }
			end
		end
	end
	return nil
end

-- Deux sous-chaînes disjointes, non collées, qui sont des entiers consécutifs.
local function findConsecutivePairNearby(s)
	local L, subs = #s, {}
	for i = 0, L - 1 do
		for len = 1, L - i do
			local p = ssub(s, i + 1, i + len)
			if not hasLeadingZero(p) then
				table.insert(subs, { tonumber(p), i, i + len })
			end
		end
	end
	for x = 1, #subs do
		for y = x + 1, #subs do
			local a, b = subs[x], subs[y]
			if abs(a[1] - b[1]) ~= 1 then continue end
			if a[3] - a[2] < 2 and b[3] - b[2] < 2 then continue end
			if a[3] < b[2] or b[3] < a[2] then
				return { range(a[2], a[3]), range(b[2], b[3]) }
			end
		end
	end
	return nil
end

-- k entiers consécutifs (montants ou descendants) écrits à la suite quelque part dans le nombre.
local function chainFrom(s, i, len, v, step, k)
	local groups = { range(i, i + len) }
	local pos, multi = i + len, len >= 2
	for j = 1, k - 1 do
		local nv = v + j * step
		if nv < 0 then return nil end
		local str = tostring(nv)
		if pos + #str > #s or ssub(s, pos + 1, pos + #str) ~= str then return nil end
		table.insert(groups, range(pos, pos + #str))
		if #str >= 2 then multi = true end
		pos += #str
	end
	return if multi then { start = i, stop = pos, groups = groups } else nil
end

local function findConsecutiveRunAdjacent(s, k)
	local L = #s
	for i = 0, L - 1 do
		local found = nil
		local len = 1
		while len <= L - i - (k - 1) and not found do
			local first = ssub(s, i + 1, i + len)
			if not hasLeadingZero(first) then
				local v = tonumber(first)
				found = chainFrom(s, i, len, v, 1, k) or chainFrom(s, i, len, v, -1, k)
			end
			len += 1
		end
		if found and not (found.start == 0 and found.stop == L) then return found.groups end
	end
	return nil
end

local function findArithmeticSplit(s)
	for k = 3, #s do
		local m = findSplit(s, k, function(nums)
			local diff = nums[2] - nums[1]
			if diff >= -1 and diff <= 1 then return false end
			for i = 3, #nums do
				if nums[i] - nums[i - 1] ~= diff then return false end
			end
			return true
		end)
		if m then return m end
	end
	return nil
end

local function findGeometricSplit(s)
	for k = 3, #s do
		local m = findSplit(s, k, function(nums)
			for _, v in nums do
				if v <= 0 then return false end
			end
			if nums[1] == nums[2] then return false end
			for i = 1, #nums - 2 do
				if nums[i + 1] * nums[i + 1] ~= nums[i] * nums[i + 2] then return false end
			end
			return true
		end)
		if m then return m end
	end
	return nil
end

local function findEquation(s)
	local op = nil
	local m = findSplit(s, 3, function(nums)
		local a, b, c = nums[1], nums[2], nums[3]
		if a == 0 or b == 0 or c == 0 then return false end
		if a + b == c then
			op = "+"
		elseif a - b == c then
			op = "−"
		elseif a * b == c then
			op = "×"
		elseif a % b == 0 and a / b == c then
			op = "÷"
		else
			return false
		end
		return true
	end)
	if m then m.op = op end
	return m
end

-- Runs maximaux de chiffres identiques : { {start, end}, ... } (0-based, end exclu)
local function runsOf(s)
	local out, st, L = {}, 0, #s
	for i = 1, L do
		if i == L or sbyte(s, i + 1) ~= sbyte(s, st + 1) then
			table.insert(out, { st, i })
			st = i
		end
	end
	return out
end

---------------------------------------------------------------------- contexte partagé par tous les checks
local function contextOf(n)
	local s = tostring(n)
	local L = #s
	local d = {}
	local cnt = { [0] = 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 }
	local sum, prod = 0, if n == 0 then 0 else 1
	for i = 0, L - 1 do
		local v = sbyte(s, i + 1) - 48
		d[i] = v
		cnt[v] += 1
		sum += v
		prod *= v
	end
	local distinct = 0
	for dg = 0, 9 do
		if cnt[dg] > 0 then distinct += 1 end
	end
	return { n = n, s = s, L = L, d = d, cnt = cnt, sum = sum, prod = prod, distinct = distinct }
end

local function runs(c)
	local r = c.runs
	if not r then
		r = runsOf(c.s)
		c.runs = r
	end
	return r
end

---------------------------------------------------------------------- helpers de forme
local function monotone(d, L, ok)
	if L < 2 then return false end
	for i = 1, L - 1 do
		if not ok(d[i - 1], d[i]) then return false end
	end
	return true
end

-- dir=1 : monte strictement jusqu'au premier pic puis descend strictement. dir=-1 : l'inverse.
local function strictPeak(d, L, dir)
	if L < 3 then return false end
	local peak = -1
	for i = 1, L - 2 do
		if dir * (d[i] - d[i - 1]) > 0 and dir * (d[i] - d[i + 1]) > 0 then
			peak = i
			break
		end
	end
	if peak < 0 then return false end
	for i = 1, peak do
		if dir * (d[i] - d[i - 1]) <= 0 then return false end
	end
	for i = peak + 1, L - 1 do
		if dir * (d[i] - d[i - 1]) >= 0 then return false end
	end
	return true
end

-- Monte puis descend (dir=1), paliers autorisés, une seule inversion.
local function softPeak(d, L, dir)
	local rose, fell = false, false
	for i = 1, L - 1 do
		local delta = dir * (d[i] - d[i - 1])
		if delta > 0 then
			if fell then return false end
			rose = true
		elseif delta < 0 then
			fell = true
		end
	end
	return rose and fell
end

local function zigzag(d, L)
	for i = 2, L - 1 do
		local a, b = d[i - 1] - d[i - 2], d[i] - d[i - 1]
		if (a > 0 and b > 0) or (a < 0 and b < 0) then return false end
	end
	return true
end

local function anyStep(c, dir)
	for i = 1, c.L - 1 do
		if dir * (c.d[i] - c.d[i - 1]) > 0 then return true end
	end
	return false
end

local function allDigits(c, pred)
	for i = 0, c.L - 1 do
		if not pred(c.d[i]) then return false end
	end
	return true
end

local function countWhere(cnt, pred)
	local k = 0
	for dg = 0, 9 do
		if pred(cnt[dg]) then k += 1 end
	end
	return k
end

local function firstRun(c, minLen)
	for _, r in runs(c) do
		if r[2] - r[1] >= minLen then return r end
	end
	return nil
end

local function findPocketMirror(s)
	local L = #s
	for len = 4, L do
		for i = 0, L - len do
			if isPalindrome(ssub(s, i + 1, i + len)) then return range(i, i + len) end
		end
	end
	return nil
end

local function findMiniScramble(s)
	local L = #s
	for len = 3, L do
		for i = 0, L - len do
			if isScrambledRun(ssub(s, i + 1, i + len), 3) then return range(i, i + len) end
		end
	end
	return nil
end

local function findHop(c)
	local L, d = c.L, c.d
	if L < 3 or c.distinct < 2 then return nil end
	for i = 0, L - 3 do
		if d[i + 2] ~= d[i] then continue end
		local extendsRight = L > i + 4 and d[i + 4] == d[i]
		local extendsLeft = i >= 2 and d[i - 2] == d[i]
		if not extendsRight and not extendsLeft then return { i, i + 2 } end
	end
	return nil
end

local function findDoubleHop(c)
	local L, d = c.L, c.d
	if L < 5 or c.distinct < 2 then return nil end
	for i = 0, L - 5 do
		if d[i] == d[i + 2] and d[i] == d[i + 4] then return { i, i + 2, i + 4 } end
	end
	return nil
end

local function findMiniEcho(c)
	local d = c.d
	for i = 0, c.L - 4 do
		if d[i] == d[i + 2] and d[i + 1] == d[i + 3] then return i end
	end
	return nil
end

local function findRhyme(s)
	local L = #s
	if L < 4 then return nil end
	for len = 2, floor(L / 2) do
		for i = 0, L - len do
			local j = indexOf(s, ssub(s, i + 1, i + len), i + len)
			if j ~= -1 then return { range(i, i + len), range(j, j + len) } end
		end
	end
	return nil
end

local function findContiguousTwoPair(c)
	local d = c.d
	for i = 0, c.L - 4 do
		if d[i] == d[i + 1] and d[i + 2] == d[i + 3] and d[i] ~= d[i + 2] then return i end
	end
	return -1
end

-- Trois paires collées "aabbcc" où chaque chiffre n'apparaît que dans sa paire.
local function findContiguousThreePair(c)
	local r = runs(c)
	local function lonePair(run)
		return run[2] - run[1] == 2 and c.cnt[c.d[run[1]]] == 2
	end
	for i = 1, #r - 2 do
		if lonePair(r[i]) and lonePair(r[i + 1]) and lonePair(r[i + 2]) then
			return { range(r[i][1], r[i][2]), range(r[i + 1][1], r[i + 1][2]), range(r[i + 2][1], r[i + 2][2]) }
		end
	end
	return nil
end

-- Un brelan collé (3+) directement voisin d'une paire collée (2+) d'un autre chiffre.
local function findContiguousBoat(c)
	local r = runs(c)
	for i = 1, #r - 1 do
		local a, b = r[i][2] - r[i][1], r[i + 1][2] - r[i + 1][1]
		if (a >= 3 and b >= 2) or (a >= 2 and b >= 3) then
			return { range(r[i][1], r[i][2]), range(r[i + 1][1], r[i + 1][2]) }
		end
	end
	return nil
end

---------------------------------------------------------------------- tables de badges simples
local CONTAINS = {
	NICE = "69", VERY_NICE = "6969", BOTANIST = "420", DEVIL = "666", LEET = "1337", HELL = "7734",
	BOOB_8008 = "8008", BOOB_58008 = "58008", BOOB_80085 = "80085", HELLO = "07734", MEANING = "42",
	EMERGENCY = "911", ERROR = "404", DEEPER_MEANING = "4242", SECRET_AGENT = "007", BIG_BROTHER = "1984",
	PI_CONTAINS_3 = "314", PI_CONTAINS_4 = "3141", PI_CONTAINS_5 = "31415",
	E_CONTAINS_3 = "271", E_CONTAINS_4 = "2718", E_CONTAINS_5 = "27182",
	TAU_SLICE_4 = "6283", TAU_SLICE_5 = "62831",
	SIXTY_SEVEN = "67", SIXTY_SEVEN_DOUBLE = "6767", EIGHTY_SIX = "86", ORIENTATION = "101", CALENDAR = "365",
	LUCKY_7 = "7", JACKPOT = "777", JACKPOT_FOUR = "7777", JACKPOT_FIVE = "77777", JACKPOT_SIX = "777777",
	ROYAL_FLUSH = "56789",
	DRASTIX = "235", -- badge perso, absent de l'original
	DEEP_VOID = "00", DEEP_VOID_THREE = "000", DEEP_VOID_FOUR = "0000", DEEP_VOID_FIVE = "00000",
}
local EXACT = {
	NICE_EXACT = { "69" }, JACKPOT_EXACT = { "777" }, BOTANIST_EXACT = { "420" }, DEVIL_EXACT = { "666" },
	LEET_EXACT = { "1337" }, EXACT_HELL = { "7734" }, EXACT_BOOB_80085 = { "80085" }, MEANING_EXACT = { "42" },
	EMERGENCY_EXACT = { "911" }, ERROR_EXACT = { "404" }, INFERNAL = { "666666" }, FOOTBALL_17776 = { "17776" },
	VERY_VERY_NICE = { "696969" }, HOTBOX = { "420420" }, MAYDAY = { "911911" }, UNIVERSAL_ANSWER = { "424242" },
	BIG_BROTHER_EXACT = { "1984" }, SIXTY_SEVEN_EXACT = { "67" }, EIGHTY_SIX_EXACT = { "86" },
	ORIENTATION_EXACT = { "101" }, CALENDAR_EXACT = { "365" }, BRAINROT = { "676767" }, GROUNDHOG_DAY = { "365365" },
	FULL_DAY = { "86400" }, ONE_MILLION = { "1000000" },
	EXACT_BOOB = { "8008", "58008" }, ULTIMEME_EXACT = { "69420", "42069" }, ALWAYS = { "247365", "365247" },
	PI = { "314", "3141", "31415", "314159" }, E = { "271", "2718", "27182", "271828" },
	TAU = { "6283", "62831", "628318" }, GOLDEN_RATIO = { "1618", "16180", "161803" },
	DIGIT_ZERO = { "0" }, DIGIT_ONE = { "1" }, DIGIT_TWO = { "2" }, DIGIT_THREE = { "3" }, DIGIT_FOUR = { "4" },
	DIGIT_FIVE = { "5" }, DIGIT_SIX = { "6" }, DIGIT_SEVEN = { "7" }, DIGIT_EIGHT = { "8" }, DIGIT_NINE = { "9" },
}
local ENDS = {
	CLEAN = "0", CENTURY = "00", MILLENNIUM = "000", EPOCH = "0000", EON = "00000",
	SEMI_CLEAN = "5", SEMI_CENTURY = "50", SEMI_MILLENNIUM = "500", SEMI_EPOCH = "5000", SEMI_EON = "50000",
	QUARTER_CENTURY = "25", THREE_QUARTER_CENTURY = "75",
	DOUBLE_NINE = "99", TRIPLE_NINE = "999", QUAD_NINE = "9999", QUINT_NINE = "99999",
}
local SINGLE_DIGIT_COUNT = {
	GHOST = 0, HYDROGEN = 1, HELIUM = 2, LITHIUM = 3, BERYLLIUM = 4, BORON = 5, CARBON = 6, NITROGEN = 7, OXYGEN = 8, FLUORINE = 9,
}
local POWERS = {
	FOURTH_POWER = 4, FIFTH_POWER = 5, SIXTH_POWER = 6, SEVENTH_POWER = 7, EIGHTH_POWER = 8, NINTH_POWER = 9,
	TENTH_POWER = 10, ELEVENTH_POWER = 11, THIRTEENTH_POWER = 13, SEVENTEENTH_POWER = 17, NINETEENTH_POWER = 19,
}
local LENGTHS = { ONE_DIGIT = 1, TWO_DIGITS = 2, THREE_DIGITS = 3, FOUR_DIGITS = 4, FIVE_DIGITS = 5, SIX_DIGITS = 6 }
local DIVISORS = { DOZEN = 12, LUCKY_SEVEN_DIV = 7, ELEVEN = 11 }
local STROBO = { [0] = 0, [1] = 1, [6] = 9, [8] = 8, [9] = 6 }
local FLUSH_RUNS = { "02468", "13579", "86420", "97531" }

local function up(a, b) return b > a end
local function down(a, b) return b < a end
local function upOne(a, b) return b == a + 1 end
local function downOne(a, b) return b == a - 1 end
local function upOrFlat(a, b) return b >= a end
local function downOrFlat(a, b) return b <= a end
local function isEvenDigit(v) return v % 2 == 0 end
local function isOddDigit(v) return v % 2 == 1 end

---------------------------------------------------------------------- checks : id -> (ctx) -> bool
local CHECKS = {
	PRIME = function(c) return isPrime(c.n) end,
	PALINDROME = function(c) return isPalindrome(c.s) end,
	POCKET_MIRROR = function(c) return findPocketMirror(c.s) ~= nil end,
	HEAVY = function(c) return c.sum > 45 end,
	FEATHER = function(c) return c.sum < 15 end,
	BLACKJACK = function(c) return c.sum == 21 end,
	VOID = function(c) return c.cnt[0] == 0 end,
	EVEN = function(c) return c.n % 2 == 0 end,
	ODD = function(c) return c.n % 2 == 1 end,
	COLOSSAL = function(c) return c.n > 999000 end,
	GROUNDED = function(c) return c.L >= 2 and c.d[0] < c.d[c.L - 1] end,
	LIFTOFF = function(c) return c.L >= 2 and c.d[0] > c.d[c.L - 1] end,
	EQUILIBRIUM = function(c) return c.L >= 2 and c.d[0] == c.d[c.L - 1] end,
	GAP_ONE = function(c) return c.L >= 2 and abs(c.d[0] - c.d[c.L - 1]) == 1 end,
	SANDWICH = function(c)
		if c.L < 3 or c.d[0] ~= c.d[c.L - 1] then return false end
		for i = 1, c.L - 2 do
			if c.d[i] ~= c.d[0] then return true end
		end
		return false
	end,
	TURTLE = function(c)
		if c.L < 2 then return false end
		for i = 1, c.L - 1 do
			if abs(c.d[i] - c.d[i - 1]) > 1 then return false end
		end
		return true
	end,
	FIREFLY = function(c)
		return c.L >= 4 and c.distinct == 2 and countWhere(c.cnt, function(x) return x == 1 end) > 0
	end,
	ECHO = function(c)
		return c.L >= 2 and c.L % 2 == 0 and ssub(c.s, 1, c.L / 2) == ssub(c.s, c.L / 2 + 1)
	end,
	BALANCED = function(c)
		if c.L < 2 or c.L % 2 ~= 0 then return false end
		local a, b, h = 0, 0, c.L / 2
		for i = 0, c.L - 1 do
			if i < h then a += c.d[i] else b += c.d[i] end
		end
		return a == b
	end,
	BOOKENDS = function(c) return c.L >= 4 and ssub(c.s, 1, 2) == ssub(c.s, -2) end,
	MIRROR_BOOKENDS = function(c) return c.L >= 4 and c.d[0] == c.d[c.L - 1] and c.d[1] == c.d[c.L - 2] end,
	PAIRED_BOOKENDS = function(c)
		return c.L >= 4 and c.d[0] == c.d[1] and c.d[c.L - 2] == c.d[c.L - 1] and c.d[0] ~= c.d[c.L - 2]
	end,

	ASCENSION = function(c) return monotone(c.d, c.L, up) end,
	DECAY = function(c) return monotone(c.d, c.L, down) end,
	CASCADE = function(c) return monotone(c.d, c.L, upOne) end,
	WATERFALL = function(c) return monotone(c.d, c.L, downOne) end,
	STEPS = function(c) return monotone(c.d, c.L, upOrFlat) and anyStep(c, 1) end,
	SLOPES = function(c) return monotone(c.d, c.L, downOrFlat) and anyStep(c, -1) end,
	MOUNTAIN = function(c) return strictPeak(c.d, c.L, 1) end,
	VALLEY = function(c) return strictPeak(c.d, c.L, -1) end,
	MESA = function(c) return softPeak(c.d, c.L, 1) end,
	CANYON = function(c) return softPeak(c.d, c.L, -1) end,
	HILLS = function(c)
		if c.L < 4 then return false end
		for i = 1, c.L - 1 do
			if c.d[i] == c.d[i - 1] then return false end
		end
		return zigzag(c.d, c.L)
	end,
	DUNES = function(c)
		local squashed, k = { [0] = c.d[0] }, 1
		for i = 1, c.L - 1 do
			if c.d[i] ~= c.d[i - 1] then
				squashed[k] = c.d[i]
				k += 1
			end
		end
		return k >= 4 and zigzag(squashed, k)
	end,
	EVEN_SPACING = function(c)
		if c.L < 3 then return false end
		local step = c.d[1] - c.d[0]
		for i = 2, c.L - 1 do
			if c.d[i] - c.d[i - 1] ~= step then return false end
		end
		return true
	end,
	EVEN_SPACING_ABS = function(c)
		if c.L < 3 then return false end
		local gap = abs(c.d[1] - c.d[0])
		for i = 2, c.L - 1 do
			if abs(c.d[i] - c.d[i - 1]) ~= gap then return false end
		end
		return true
	end,
	SEQUENCE_3 = function(c) return findDigitRun(c.d, c.L, 3) >= 0 end,
	SEQUENCE_4 = function(c) return findDigitRun(c.d, c.L, 4) >= 0 end,
	STRAIGHT = function(c) return findDigitRun(c.d, c.L, 5) >= 0 end,
	SEQUENCE_6 = function(c) return findDigitRun(c.d, c.L, 6) >= 0 end,
	SCRAMBLE = function(c) return isScrambledRun(c.s, 2) end,
	MINI_SCRAMBLE = function(c) return findMiniScramble(c.s) ~= nil end,
	NEIGHBORS = function(c)
		for i = 1, c.L - 1 do
			if abs(c.d[i] - c.d[i - 1]) == 1 then return true end
		end
		return false
	end,
	STRAIGHT_FLUSH = function(c)
		for _, x in FLUSH_RUNS do
			if contains(c.s, x) then return true end
		end
		return false
	end,
	FLUSH = function(c) return allDigits(c, isEvenDigit) or allDigits(c, isOddDigit) end,
	ALTERNATOR = function(c)
		if c.L < 2 then return false end
		for i = 1, c.L - 1 do
			if c.d[i] % 2 == c.d[i - 1] % 2 then return false end
		end
		return true
	end,
	LOW_BALL = function(c) return allDigits(c, function(v) return v <= 4 end) end,
	HIGH_ROLLER = function(c) return allDigits(c, function(v) return v >= 5 end) end,
	DIVISIBLE_BY_THREE = function(c) return allDigits(c, function(v) return v % 3 == 0 end) end,
	BINARY_SOUL = function(c) return allDigits(c, function(v) return v <= 1 end) end,
	STROBOGRAMMATIC = function(c)
		for i = 0, c.L - 1 do
			local r = STROBO[c.d[c.L - 1 - i]]
			if r == nil or r ~= c.d[i] then return false end
		end
		return true
	end,

	DUALITY = function(c) return c.distinct == 2 end,
	TRINITY = function(c) return c.distinct == 3 end,
	QUARTET = function(c) return c.distinct == 4 end,
	HETEROGENEOUS = function(c) return c.distinct == c.L end,
	HOMOGENEOUS = function(c) return c.L >= 2 and c.distinct == 1 end,
	ZIPPER = function(c)
		if c.L < 2 or c.distinct ~= 2 then return false end
		for i = 1, c.L - 1 do
			if c.d[i] == c.d[i - 1] then return false end
		end
		return true
	end,
	HOPSCOTCH = function(c) return findHop(c) ~= nil end,
	DOUBLE_HOP = function(c) return findDoubleHop(c) ~= nil end,
	MINI_ECHO = function(c) return findMiniEcho(c) ~= nil end,
	RHYME = function(c) return findRhyme(c.s) ~= nil end,

	PAIR = function(c) return countWhere(c.cnt, function(x) return x >= 2 end) >= 1 end,
	TWO_PAIR = function(c) return countWhere(c.cnt, function(x) return x >= 2 end) >= 2 end,
	THREE_PAIR = function(c) return countWhere(c.cnt, function(x) return x == 2 end) >= 3 end,
	TRIPS = function(c) return countWhere(c.cnt, function(x) return x == 3 end) >= 1 end,
	QUADS = function(c) return countWhere(c.cnt, function(x) return x >= 4 end) >= 1 end,
	FIVE_OF_A_KIND = function(c) return countWhere(c.cnt, function(x) return x >= 5 end) >= 1 end,
	BOAT = function(c)
		return countWhere(c.cnt, function(x) return x >= 3 end) >= 1 and countWhere(c.cnt, function(x) return x >= 2 end) >= 2
	end,
	SNAKE_EYES = function(c)
		if c.cnt[1] ~= 2 then return false end
		for dg = 0, 9 do
			if dg ~= 1 and c.cnt[dg] >= 2 then return false end
		end
		return true
	end,
	CONTIGUOUS_PAIR = function(c) return firstRun(c, 2) ~= nil end,
	CONTIGUOUS_TRIPS = function(c) return firstRun(c, 3) ~= nil end,
	CONTIGUOUS_QUADS = function(c) return firstRun(c, 4) ~= nil end,
	CONTIGUOUS_FIVES = function(c) return firstRun(c, 5) ~= nil end,
	CONTIGUOUS_SIXES = function(c) return firstRun(c, 6) ~= nil end,
	CONTIGUOUS_TWO_PAIR = function(c) return findContiguousTwoPair(c) >= 0 end,
	CONTIGUOUS_THREE_PAIR = function(c) return findContiguousThreePair(c) ~= nil end,
	CONTIGUOUS_BOAT = function(c) return findContiguousBoat(c) ~= nil end,
	FRAMED_PAIR = function(c)
		local d = c.d
		return c.L == 4 and d[1] == d[2] and d[0] ~= d[1] and d[3] ~= d[1]
	end,
	FRAMED_TRIPLE = function(c)
		local d = c.d
		return c.L == 5 and d[1] == d[2] and d[2] == d[3] and d[0] ~= d[1] and d[4] ~= d[1]
	end,
	FRAMED_QUAD = function(c)
		local d = c.d
		return c.L == 6 and d[1] == d[2] and d[2] == d[3] and d[3] == d[4] and d[0] ~= d[1] and d[5] ~= d[1]
	end,
	FRAMED_DOUBLE = function(c)
		local d = c.d
		return c.L == 6 and d[1] == d[2] and d[3] == d[4] and d[1] ~= d[3] and d[0] ~= d[1] and d[5] ~= d[3]
	end,

	SQUARE = function(c) return isSquare(c.n) end,
	CUBE = function(c) return isCube(c.n) end,
	FIBONACCI = function(c) return isFibonacci(c.n) end,
	POWER_OF_TWO = function(c) return c.n > 0 and bit32.band(c.n, c.n - 1) == 0 end,
	POWER_OF_THREE = function(c) return isPowerOf(c.n, 3) end,
	POWER_OF_FIVE = function(c) return isPowerOf(c.n, 5) end,
	POWER_OF_SEVEN = function(c) return isPowerOf(c.n, 7) end,
	OUROBOROS = function(c) return SELF_POWERS[c.n] == true end,
	FACTORIAL = function(c) return FACTORIALS[c.n] == true end,
	PRONIC = function(c) return isPronic(c.n) end,
	HARSHAD = function(c) return c.n > 0 and c.sum > 0 and c.n % c.sum == 0 end,
	SPY = function(c) return c.n ~= 1 and c.n ~= 2 and c.sum == c.prod end,
	EQUATION = function(c) return findEquation(c.s) ~= nil end,
	ARITHMETIC = function(c) return findArithmeticSplit(c.s) ~= nil end,
	GEOMETRIC = function(c) return findGeometricSplit(c.s) ~= nil end,
	ULTIMEME = function(c) return contains(c.s, "69") and contains(c.s, "420") end,

	CONSEC_PAIR_EXACT = function(c) return findConsecutiveSplit(c.s, 2) ~= nil end,
	CONSEC_TRIPLE_EXACT = function(c)
		local m = findConsecutiveSplit(c.s, 3)
		return m ~= nil and isStrictlyMonotonic(m.nums)
	end,
	CONSEC_TRIPLE_SCRAMBLED = function(c)
		local m = findConsecutiveSplit(c.s, 3)
		return m ~= nil and not isStrictlyMonotonic(m.nums)
	end,
	CONSEC_QUAD_EXACT = function(c)
		local m = findConsecutiveSplit(c.s, 4)
		return m ~= nil and isStrictlyMonotonic(m.nums)
	end,
	CONSEC_QUAD_SCRAMBLED = function(c)
		local m = findConsecutiveSplit(c.s, 4)
		return m ~= nil and not isStrictlyMonotonic(m.nums)
	end,
	CONSEC_PAIR_ADJACENT = function(c) return findConsecutivePairAdjacent(c.s) ~= nil end,
	CONSEC_PAIR_NEARBY = function(c) return findConsecutivePairNearby(c.s) ~= nil end,
	CONSEC_TRIPLE_CONTAINS = function(c) return findConsecutiveRunAdjacent(c.s, 3) ~= nil end,
	CONSEC_QUAD_CONTAINS = function(c) return findConsecutiveRunAdjacent(c.s, 4) ~= nil end,
}
for id, str in CONTAINS do
	CHECKS[id] = function(c) return contains(c.s, str) end
end
for id, list in EXACT do
	local set = {}
	for _, v in list do
		set[v] = true
	end
	CHECKS[id] = function(c) return set[c.s] == true end
end
for id, str in ENDS do
	local k = #str
	CHECKS[id] = function(c) return c.L >= k and ssub(c.s, -k) == str end
end
for id, dg in SINGLE_DIGIT_COUNT do
	CHECKS[id] = function(c) return c.cnt[dg] == 1 end
end
for id, k in POWERS do
	CHECKS[id] = function(c) return isPerfectPower(c.n, k) end
end
for id, len in LENGTHS do
	CHECKS[id] = function(c) return c.L == len end
end
for id, div in DIVISORS do
	CHECKS[id] = function(c) return c.n > 0 and c.n % div == 0 end
end

---------------------------------------------------------------------- surlignage des chiffres (groupes d'index 0-based)
local function all(c) return { range(0, c.L) } end
local function ends(c) return { { 0 }, { c.L - 1 } } end
local function halves(c) return { range(0, c.L / 2), range(c.L / 2, c.L) } end
local function outerPairs(c) return { { 0, 1 }, { c.L - 2, c.L - 1 } } end
local function digitsWhere(c, pred)
	local out = {}
	for dg = 0, 9 do
		if pred(c.cnt[dg]) then table.insert(out, indicesOf(c.s, tostring(dg))) end
	end
	return out
end
local function digitRun(len)
	return function(c)
		local i = findDigitRun(c.d, c.L, len)
		return { range(i, i + len) }
	end
end
local function runOf(minLen)
	return function(c)
		local r = firstRun(c, minLen)
		return { range(r[1], r[2]) }
	end
end
local function splitGroups(k)
	return function(c) return findConsecutiveSplit(c.s, k).groups end
end

local HIGHLIGHTS = {
	GROUNDED = ends, LIFTOFF = ends, EQUILIBRIUM = ends, GAP_ONE = ends, SANDWICH = ends,
	ECHO = halves, BALANCED = halves,
	BOOKENDS = outerPairs, MIRROR_BOOKENDS = outerPairs, PAIRED_BOOKENDS = outerPairs,
	SEQUENCE_3 = digitRun(3), SEQUENCE_4 = digitRun(4), STRAIGHT = digitRun(5), SEQUENCE_6 = digitRun(6),
	STRAIGHT_FLUSH = function(c)
		for _, x in FLUSH_RUNS do
			local i = indexOf(c.s, x)
			if i >= 0 then return { range(i, i + 5) } end
		end
		return nil
	end,
	MINI_SCRAMBLE = function(c) return { findMiniScramble(c.s) } end,
	POCKET_MIRROR = function(c) return { findPocketMirror(c.s) } end,
	NEIGHBORS = function(c)
		for i = 1, c.L - 1 do
			if abs(c.d[i] - c.d[i - 1]) == 1 then return { { i - 1, i } } end
		end
		return nil
	end,
	HOPSCOTCH = function(c) return { findHop(c) } end,
	DOUBLE_HOP = function(c) return { findDoubleHop(c) } end,
	MINI_ECHO = function(c)
		local i = findMiniEcho(c)
		return { { i, i + 1 }, { i + 2, i + 3 } }
	end,
	RHYME = function(c) return findRhyme(c.s) end,
	DUALITY = function(c) return digitsWhere(c, function(x) return x > 0 end) end,
	TRINITY = function(c) return digitsWhere(c, function(x) return x > 0 end) end,
	QUARTET = function(c) return digitsWhere(c, function(x) return x > 0 end) end,
	FIREFLY = function(c) return digitsWhere(c, function(x) return x == 1 end) end,
	PAIR = function(c) return digitsWhere(c, function(x) return x >= 2 end) end,
	TWO_PAIR = function(c) return digitsWhere(c, function(x) return x >= 2 end) end,
	THREE_PAIR = function(c) return digitsWhere(c, function(x) return x == 2 end) end,
	TRIPS = function(c) return digitsWhere(c, function(x) return x == 3 end) end,
	QUADS = function(c) return digitsWhere(c, function(x) return x >= 4 end) end,
	FIVE_OF_A_KIND = function(c) return digitsWhere(c, function(x) return x >= 5 end) end,
	BOAT = function(c) return digitsWhere(c, function(x) return x >= 2 end) end,
	SNAKE_EYES = function(c) return { indicesOf(c.s, "1") } end,
	CONTIGUOUS_PAIR = runOf(2), CONTIGUOUS_TRIPS = runOf(3), CONTIGUOUS_QUADS = runOf(4),
	CONTIGUOUS_FIVES = runOf(5), CONTIGUOUS_SIXES = runOf(6),
	CONTIGUOUS_TWO_PAIR = function(c)
		local i = findContiguousTwoPair(c)
		return { { i, i + 1 }, { i + 2, i + 3 } }
	end,
	CONTIGUOUS_THREE_PAIR = findContiguousThreePair,
	CONTIGUOUS_BOAT = findContiguousBoat,
	FRAMED_PAIR = function() return { { 1, 2 } } end,
	FRAMED_TRIPLE = function() return { { 1, 2, 3 } } end,
	FRAMED_QUAD = function() return { { 1, 2, 3, 4 } } end,
	FRAMED_DOUBLE = function() return { { 1, 2 }, { 3, 4 } } end,
	ULTIMEME = function(c)
		local a, b = indexOf(c.s, "69"), indexOf(c.s, "420")
		return { { a, a + 1 }, { b, b + 1, b + 2 } }
	end,
	EQUATION = function(c) return findEquation(c.s).groups end,
	ARITHMETIC = function(c) return findArithmeticSplit(c.s).groups end,
	GEOMETRIC = function(c) return findGeometricSplit(c.s).groups end,
	CONSEC_PAIR_EXACT = splitGroups(2),
	CONSEC_TRIPLE_EXACT = splitGroups(3), CONSEC_TRIPLE_SCRAMBLED = splitGroups(3),
	CONSEC_QUAD_EXACT = splitGroups(4), CONSEC_QUAD_SCRAMBLED = splitGroups(4),
	CONSEC_PAIR_ADJACENT = function(c) return findConsecutivePairAdjacent(c.s) end,
	CONSEC_PAIR_NEARBY = function(c) return findConsecutivePairNearby(c.s) end,
	CONSEC_TRIPLE_CONTAINS = function(c) return findConsecutiveRunAdjacent(c.s, 3) end,
	CONSEC_QUAD_CONTAINS = function(c) return findConsecutiveRunAdjacent(c.s, 4) end,
}
for id, str in CONTAINS do
	HIGHLIGHTS[id] = function(c)
		local i = indexOf(c.s, str)
		return { range(i, i + #str) }
	end
end
HIGHLIGHTS.LUCKY_7 = function(c) return { indicesOf(c.s, "7") } end
for id, str in ENDS do
	HIGHLIGHTS[id] = function(c) return { range(c.L - #str, c.L) } end
end
for id, dg in SINGLE_DIGIT_COUNT do
	HIGHLIGHTS[id] = function(c) return { indicesOf(c.s, tostring(dg)) } end
end

---------------------------------------------------------------------- raretés
local BADGE_TIERS = { { 1e3, "common" }, { 1e4, "uncommon" }, { 1e5, "rare" }, { 1e6, "epic" }, { 1e7, "anomaly" } }
local CARD_TIERS = { { 1, "trash" }, { 50, "common" }, { 75, "uncommon" }, { 90, "rare" }, { 95, "epic" }, { 99, "anomaly" } }
local TIER_ORDER = { "trash", "common", "uncommon", "rare", "epic", "anomaly", "mythic" }
local TIER_RANK = {}
for i, t in TIER_ORDER do
	TIER_RANK[t] = i - 1
end

local function badgeTier(score)
	for _, e in BADGE_TIERS do
		if score < e[1] then return e[2] end
	end
	return "mythic"
end

---------------------------------------------------------------------- moteur
local Engine = {
	MAX_ROLL = MAX_ROLL,
	TIER_ORDER = TIER_ORDER,
	TIER_RANK = TIER_RANK,
	badgeTier = badgeTier,
}

local badges, byId = {}, {}
for i, m in BadgeMeta do
	local check = CHECKS[m.id]
	assert(check, "Badge sans check : " .. m.id)
	local b = table.clone(m)
	b.index = i
	b.check = check
	b.tier = badgeTier(m.score)
	badges[i] = b
	byId[m.id] = b
end
Engine.badges = badges
Engine.byId = byId

local pctTable = Percentiles.entries

function Engine.percentileOf(total)
	local lo, hi, found = 1, #pctTable, 0
	while lo <= hi do
		local mid = (lo + hi) // 2
		if pctTable[mid][1] <= total then
			found = mid
			lo = mid + 1
		else
			hi = mid - 1
		end
	end
	return if found == 0 then 0 else pctTable[found][2]
end

function Engine.cardTier(total)
	local p = Engine.percentileOf(total)
	for _, e in CARD_TIERS do
		if p < e[1] then return e[2] end
	end
	return "mythic"
end

-- Total EP d'un nombre (seul le meilleur badge de chaque famille compte).
function Engine.scoreOf(n)
	local c = contextOf(n)
	local best = {}
	local total = 0
	for _, b in badges do
		if not b.check(c) then continue end
		if not b.family then
			total += b.score
			continue
		end
		local cur = best[b.family]
		if not cur or b.score > cur.score then best[b.family] = b end
	end
	for _, b in best do
		total += b.score
	end
	return total
end

local function byScore(a, b)
	if a.score ~= b.score then return a.score > b.score end
	return a.index < b.index -- équivalent du tri stable de JS
end

-- Analyse complète pour l'affichage : groupes { badge, subsidiary } du plus rare au moins rare.
function Engine.analyze(n)
	local c = contextOf(n)
	local earned = {}
	for _, b in badges do
		if b.check(c) then table.insert(earned, b) end
	end
	local sorted = table.clone(earned)
	table.sort(sorted, byScore)
	local families, groups = {}, {}
	for _, b in sorted do
		if not b.family then
			table.insert(groups, { badge = b, subsidiary = {} })
			continue
		end
		local g = families[b.family]
		if g then
			table.insert(g.subsidiary, b)
		else
			g = { badge = b, subsidiary = {} }
			families[b.family] = g
			table.insert(groups, g)
		end
	end
	local total = 0
	for _, g in groups do
		total += g.badge.score
	end
	local earnedIds = table.create(#earned)
	for i, b in earned do
		earnedIds[i] = b.id
	end
	return {
		number = n,
		str = c.s,
		total = total,
		percentile = Engine.percentileOf(total),
		tier = Engine.cardTier(total),
		groups = groups,
		earned = earned,
		earnedIds = earnedIds,
	}
end

-- Groupes de chiffres à surligner pour un badge obtenu, en positions 1-based.
function Engine.highlight(id, n)
	local c = contextOf(n)
	local fn = HIGHLIGHTS[id]
	local groups = nil
	if fn then
		local ok, res = pcall(fn, c)
		if ok then groups = res end
	end
	local valid = type(groups) == "table" and #groups > 0
	if valid then
		for _, g in groups do
			if type(g) ~= "table" then
				valid = false
				break
			end
		end
	end
	if not valid then groups = all(c) end
	local out = table.create(#groups)
	for gi, g in groups do
		local h = table.create(#g)
		for k, i in g do
			h[k] = i + 1
		end
		out[gi] = h
	end
	return out
end

-- "Top x %" / "Bottom x %" arrondi et coloré comme l'écran de résultat d'origine.
local PCT_COLORS = { Color3.fromHex("#ef4444"), Color3.fromHex("#f97316"), Color3.fromHex("#10b981"), Color3.fromHex("#22c55e"), Color3.fromHex("#eab308") }

function Engine.labelKey(p)
	local kind = if p >= 50 then 1 else 2
	local v = if p >= 50 then round(100 - p) else round(p)
	local bucket = if p >= 95 then 5 elseif p >= 80 then 4 elseif p >= 50 then 3 elseif p >= 20 then 2 else 1
	return kind, v, bucket
end

function Engine.percentileLabel(p)
	local kind, v, bucket = Engine.labelKey(p)
	local num = if v == 0 then "<1" else tostring(v)
	return (if kind == 1 then "Top " else "Bottom ") .. num .. "%", PCT_COLORS[bucket]
end

-- 1234567 -> "1,234,567"
function Engine.fmt(v)
	local s = tostring(round(v))
	local neg = ssub(s, 1, 1) == "-"
	if neg then s = ssub(s, 2) end
	local out = s:reverse():gsub("(%d%d%d)", "%1,"):reverse()
	if ssub(out, 1, 1) == "," then out = ssub(out, 2) end
	return (if neg then "-" else "") .. out
end

---------------------------------------------------------------------- ligne d'explication sous certains badges
local SUP = { ["0"] = "⁰", ["1"] = "¹", ["2"] = "²", ["3"] = "³", ["4"] = "⁴", ["5"] = "⁵", ["6"] = "⁶", ["7"] = "⁷", ["8"] = "⁸", ["9"] = "⁹" }
local function sup(k)
	return (string.gsub(tostring(k), "%d", SUP))
end
local POWER_K = {
	SQUARE = 2, CUBE = 3, FOURTH_POWER = 4, FIFTH_POWER = 5, SIXTH_POWER = 6, SEVENTH_POWER = 7, EIGHTH_POWER = 8,
	NINTH_POWER = 9, TENTH_POWER = 10, ELEVENTH_POWER = 11, THIRTEENTH_POWER = 13, SEVENTEENTH_POWER = 17, NINETEENTH_POWER = 19,
}
local BASES = { POWER_OF_TWO = 2, POWER_OF_THREE = 3, POWER_OF_FIVE = 5, POWER_OF_SEVEN = 7 }
local DIVS = { DOZEN = 12, LUCKY_SEVEN_DIV = 7, ELEVEN = 11 }
local CONSEC_IDS = {
	CONSEC_PAIR_EXACT = true, CONSEC_TRIPLE_EXACT = true, CONSEC_TRIPLE_SCRAMBLED = true, CONSEC_QUAD_EXACT = true,
	CONSEC_QUAD_SCRAMBLED = true, CONSEC_PAIR_ADJACENT = true, CONSEC_PAIR_NEARBY = true,
	CONSEC_TRIPLE_CONTAINS = true, CONSEC_QUAD_CONTAINS = true,
}

-- "7 × 9 = 63", "2¹⁰"... ; chaîne vide si le badge n'a pas de détail.
function Engine.badgeDetail(id, n)
	local fmt = Engine.fmt
	local s = tostring(n)
	local sum, prod = 0, 1
	for i = 1, #s do
		local v = sbyte(s, i) - 48
		sum += v
		prod *= v
	end
	local function parts()
		local out = {}
		for gi, g in Engine.highlight(id, n) do
			local str = ""
			for _, i in g do
				str ..= ssub(s, i, i)
			end
			out[gi] = tonumber(str)
		end
		return out
	end
	if POWER_K[id] then return tostring(round(n ^ (1 / POWER_K[id]))) .. sup(POWER_K[id]) end
	if BASES[id] then
		local k, p = 0, 1
		while p < n do
			p *= BASES[id]
			k += 1
		end
		return tostring(BASES[id]) .. sup(k)
	end
	if DIVS[id] then return `{fmt(n)} = {DIVS[id]} × {fmt(n / DIVS[id])}` end
	if CONSEC_IDS[id] then return table.concat(parts(), " · ") end
	if id == "EQUATION" then
		local v = parts()
		local a, b, c = v[1], v[2], v[3]
		local op = if a + b == c then "+" elseif a - b == c then "−" elseif a * b == c then "×" else "÷"
		return `{a} {op} {b} = {c}`
	elseif id == "ARITHMETIC" then
		local v = parts()
		local d = v[2] - v[1]
		return table.concat(v, " → ") .. `  (step {if d > 0 then "+" else ""}{d})`
	elseif id == "GEOMETRIC" then
		local v = parts()
		local ratio = string.format("%.3f", v[2] / v[1]):gsub("0+$", ""):gsub("%.$", "")
		return table.concat(v, " → ") .. `  (×{ratio})`
	elseif id == "HARSHAD" then
		return `{fmt(n)} ÷ {sum} = {fmt(n / sum)}`
	elseif id == "PRONIC" then
		local k = round((sqrt(1 + 4 * n) - 1) / 2)
		return `{k} × {k + 1}`
	elseif id == "FACTORIAL" then
		local k, f = 1, 1
		while f < n do
			k += 1
			f *= k
		end
		return `{k}!`
	elseif id == "OUROBOROS" then
		local k = 1
		while k ^ k < n do
			k += 1
		end
		return tostring(k) .. sup(k)
	elseif id == "FEATHER" or id == "HEAVY" or id == "BLACKJACK" then
		return `digit sum = {sum}`
	elseif id == "SPY" then
		return `sum {sum} = product {prod}`
	elseif id == "BALANCED" then
		local h = #s // 2
		local l = 0
		for i = 1, h do
			l += sbyte(s, i) - 48
		end
		return `{ssub(s, 1, h)} → {l}  =  {ssub(s, h + 1)} → {l}`
	end
	return ""
end

---------------------------------------------------------------------- tirage (serveur uniquement)
local rng = Random.new()
function Engine.roll()
	return rng:NextInteger(0, MAX_ROLL)
end

return Engine

--[[
	RNG∞ — rythme de la révélation, repris de js/app.js.
	Partagé par le client (animation) et le serveur (pas de nouveau tirage avant l'affichage de la rareté).
	normal = vitesse « normal » du site ; fast = game pass Fast Roll (environ deux fois plus rapide).
]]
local Timing = {}

-- Durées du site d'origine, en ms.
local R = {
	digitStart = 2000, digitBase = 1000, digitMax = 2000,
	badgeStart = 1000, badgeBase = 500, badgeMax = 1500, badgeEp = 500,
	summary = 1500, rarity = 1000, stats = 250, lifetimeShow = 1000, lifetimePause = 1500, lifetimeTick = 1500, finish = 500,
}
Timing.REVEAL = R

-- Facteurs appliqués aux durées : chiffres, arrivée des badges, fin de séquence.
Timing.SPEEDS = {
	normal = { digits = 1, badges = 0.85, base = 0.6 },
	fast = { digits = 0.45, badges = 0.4, base = 0.35 },
}

-- Chaque chiffre suivant se fait attendre un peu plus ; idem pour les badges, jusqu'au plus rare.
local function digitDelay(i, count)
	return R.digitBase + (R.digitMax - R.digitBase) * (i / (count - 1)) ^ 2
end
local function badgeDelay(i, count)
	if count <= 1 then return R.badgeBase end
	return R.badgeBase + (R.badgeMax - R.badgeBase) * (i / (count - 1)) ^ 1.5
end

-- Instant (secondes depuis le début du tirage) de chaque étape, et durées des compteurs.
-- slotCount : cases de chiffres (6 minimum) ; groupCount : badges qui comptent ; speed : "normal" ou "fast".
function Timing.schedule(slotCount, groupCount, speed)
	local f = Timing.SPEEDS[speed or "normal"] or Timing.SPEEDS.normal
	local clock = 0
	local function step(ms, factor)
		clock += ms * factor
		return clock / 1000
	end
	local s = { digits = {}, badges = {}, badgeEp = R.badgeEp * f.badges / 1000, lifetimeTick = R.lifetimeTick * f.base / 1000 }
	s.digits[1] = step(R.digitStart, f.digits)
	for i = 1, slotCount - 1 do
		s.digits[i + 1] = step(digitDelay(i - 1, slotCount), f.digits)
	end
	s.spinStop = step(0, f.base)
	for i = 0, groupCount - 1 do
		s.badges[i + 1] = step(if i == 0 then R.badgeStart else badgeDelay(i - 1, groupCount), f.badges)
	end
	s.summary = step(R.summary, f.base)
	s.rarity = step(R.rarity, f.base)
	s.stats = step(R.stats, f.base)
	s.lifetimeShow = step(R.lifetimeShow, f.base)
	s.lifetimePause = step(R.lifetimePause, f.base)
	s.finish = step(R.lifetimeTick + R.finish, f.base)
	return s
end

return Timing

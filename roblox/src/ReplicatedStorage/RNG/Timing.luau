--[[
	RNG∞ — rythme de la révélation, repris de js/app.js (vitesse « normal » du site).
	Partagé par le client (animation) et le serveur (pas de nouveau tirage avant l'affichage de la rareté).
]]
local Timing = {}

-- Durées du site d'origine, en ms.
local R = {
	digitStart = 2000, digitBase = 1000, digitMax = 2000,
	badgeStart = 1000, badgeBase = 500, badgeMax = 1500, badgeEp = 500,
	summary = 1500, rarity = 1000, stats = 250, lifetimeShow = 1000, lifetimePause = 1500, lifetimeTick = 1500, finish = 500,
}
Timing.REVEAL = R
-- Les chiffres gardent le rythme d'origine ; arrivée des badges ×0.85 ; fin de séquence ×0.6.
Timing.BADGES = 0.85
Timing.BASE = 0.6

-- Chaque chiffre suivant se fait attendre un peu plus ; idem pour les badges, jusqu'au plus rare.
local function digitDelay(i, count)
	return R.digitBase + (R.digitMax - R.digitBase) * (i / (count - 1)) ^ 2
end
local function badgeDelay(i, count)
	if count <= 1 then return R.badgeBase end
	return R.badgeBase + (R.badgeMax - R.badgeBase) * (i / (count - 1)) ^ 1.5
end

-- Instant (secondes depuis le début du tirage) de chaque étape.
-- slotCount : cases de chiffres (6 minimum) ; groupCount : badges qui comptent (sous-badges regroupés).
function Timing.schedule(slotCount, groupCount)
	local clock = 0
	local function step(ms, factor)
		clock += ms * factor
		return clock / 1000
	end
	local s = { digits = {}, badges = {} }
	s.digits[1] = step(R.digitStart, 1)
	for i = 1, slotCount - 1 do
		s.digits[i + 1] = step(digitDelay(i - 1, slotCount), 1)
	end
	s.spinStop = step(0, Timing.BASE)
	for i = 0, groupCount - 1 do
		s.badges[i + 1] = step(if i == 0 then R.badgeStart else badgeDelay(i - 1, groupCount), Timing.BADGES)
	end
	s.summary = step(R.summary, Timing.BASE)
	s.rarity = step(R.rarity, Timing.BASE)
	s.stats = step(R.stats, Timing.BASE)
	s.lifetimeShow = step(R.lifetimeShow, Timing.BASE)
	s.lifetimePause = step(R.lifetimePause, Timing.BASE)
	s.finish = step(R.lifetimeTick + R.finish, Timing.BASE)
	return s
end

return Timing

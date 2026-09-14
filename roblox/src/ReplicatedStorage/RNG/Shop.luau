--[[
	RNG∞ — boutique et progression : game passes, apparences de carte, succès (et badges Roblox associés).
	Les id valent 0 tant que les game passes et badges ne sont pas créés sur le Creator Hub :
	crée-les (Creator Hub > l'expérience > Monetization > Passes ; Engagement > Badges), puis colle leur id ici.
	Un pass à 0 s'affiche « coming soon » ; un succès à 0 est gardé dans la sauvegarde, sans badge Roblox.
]]
local Shop = {}

-- suggested : prix conseillé en Robux (le vrai prix se règle sur le Creator Hub).
Shop.passes = {
	{
		key = "FAST_ROLL", id = 0, icon = "⚡", name = "Fast Roll", suggested = 149,
		desc = "Every reveal plays about twice as fast, so you can roll twice as often.",
	},
	{
		key = "AUTO_ROLL", id = 0, icon = "🔁", name = "Auto Roll", suggested = 199,
		desc = "Rolls again by itself when a reveal ends. Switch it on from the result screen.",
	},
	{
		key = "VIP", id = 0, icon = "👑", name = "VIP", suggested = 299,
		desc = "Gold name and crown on the leaderboard and live feed, [VIP] tag in chat, and the Gold card skin.",
	},
	{
		key = "SKINS", id = 0, icon = "🎨", name = "All Card Skins", suggested = 99,
		desc = "Unlock the Neon, Galaxy and Ice card skins right away.",
	},
}

-- Apparences de la carte numéro. achievement : succès qui la débloque gratuitement ; pass : game pass qui la débloque.
Shop.skins = {
	{ key = "default", name = "Classic", desc = "The website look: the card takes the colour of its rarity." },
	{ key = "neon", name = "Neon", desc = "Animated rainbow border.", achievement = "COLLECT_50", pass = "SKINS" },
	{ key = "galaxy", name = "Galaxy", desc = "Deep-space card with white digits.", achievement = "FIRST_MYTHIC", pass = "SKINS" },
	{ key = "ice", name = "Ice", desc = "Frosted glass card.", achievement = "STREAK_7", pass = "SKINS" },
	{ key = "gold", name = "Gold", desc = "Solid gold card.", pass = "VIP" },
}

-- Succès vérifiés par le serveur ; badge = id du badge Roblox décerné (0 = pas encore créé).
Shop.achievements = {
	{ key = "FIRST_ROLL", icon = "🎲", name = "First Roll", desc = "Roll your first number.", badge = 0 },
	{ key = "ROLLS_100", icon = "💯", name = "Regular", desc = "Roll 100 numbers.", badge = 0 },
	{ key = "ROLLS_1000", icon = "🏭", name = "Number Factory", desc = "Roll 1,000 numbers.", badge = 0 },
	{ key = "FIRST_RARE", icon = "🟦", name = "Rare Find", desc = "Get a Rare roll or better.", badge = 0 },
	{ key = "FIRST_EPIC", icon = "🟪", name = "Epic Moment", desc = "Get an Epic roll or better.", badge = 0 },
	{ key = "FIRST_ANOMALY", icon = "🟧", name = "Anomaly", desc = "Get an Anomaly roll or better.", badge = 0 },
	{ key = "FIRST_MYTHIC", icon = "🟥", name = "Mythic", desc = "Get a Mythic roll (top 1%).", badge = 0 },
	{ key = "COLLECT_50", icon = "📖", name = "Collector", desc = "Collect 50 different badges.", badge = 0 },
	{ key = "COLLECT_150", icon = "📚", name = "Archivist", desc = "Collect 150 different badges.", badge = 0 },
	{ key = "STREAK_7", icon = "🔥", name = "Week Streak", desc = "Roll on 7 days in a row.", badge = 0 },
	{ key = "STREAK_30", icon = "☄️", name = "Month Streak", desc = "Roll on 30 days in a row.", badge = 0 },
}

Shop.byKey, Shop.skinsByKey, Shop.achievementsByKey = {}, {}, {}
for _, p in Shop.passes do
	Shop.byKey[p.key] = p
end
for _, s in Shop.skins do
	Shop.skinsByKey[s.key] = s
end
for _, a in Shop.achievements do
	Shop.achievementsByKey[a.key] = a
end

return Shop

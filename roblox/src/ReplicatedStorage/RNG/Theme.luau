--[[
	RNG∞ — couleurs et polices du thème sombre du site (css/style.css, tokens .dark convertis d'oklch en sRGB).
	Les couleurs « rgba » du site sont gardées en couleur + opacité (A) et appliquées en transparence.
]]
local hex = Color3.fromHex
local rgb = Color3.fromRGB
local SANS = "rbxasset://fonts/families/BuilderSans.json"
local MONO = "rbxasset://fonts/families/RobotoMono.json"

local Theme = {
	bg = hex("#111017"),
	surface = hex("#242229"),
	surfaceDim = hex("#1a1820"),
	surfaceRaised = hex("#312f37"),
	outline = hex("#47454d"),
	outlineMid = hex("#525159"),
	outlineStrong = hex("#63616a"),
	prose = hex("#f0f0f0"),
	prose2 = hex("#c4c4c4"),
	prose3 = hex("#9a9a9a"),
	qmark = hex("#4a4755"),
	epText = hex("#ffb900"),
	epSurface = hex("#461901"),
	epOutline = hex("#973c00"),
	success = hex("#00d492"),
	danger = hex("#ff6467"),

	font = Font.new(SANS, Enum.FontWeight.Regular),
	fontMedium = Font.new(SANS, Enum.FontWeight.Medium),
	fontSemi = Font.new(SANS, Enum.FontWeight.SemiBold),
	fontBold = Font.new(SANS, Enum.FontWeight.Bold),
	fontHeavy = Font.new(SANS, Enum.FontWeight.ExtraBold),
	mono = Font.new(MONO, Enum.FontWeight.Regular),
	monoBold = Font.new(MONO, Enum.FontWeight.Bold),
}

-- Carte numéro neutre (avant la révélation de la rareté).
Theme.neutral = {
	from = Theme.surfaceRaised, fromA = 1, via = Theme.surface, viaA = 1, to = Theme.surfaceRaised, toA = 1,
	border = Theme.outlineStrong, text = Theme.prose2,
}

-- from/via/to : dégradé de la carte numéro ; border / text : carte ; pill* : pastille ; hl / hlBorder : chiffres surlignés ;
-- accent : --tier-* (barres de stats).
local VIA = hex("#27272a")
Theme.tier = {
	trash = {
		from = rgb(120, 53, 15), fromA = 0.6, via = VIA, viaA = 1, to = rgb(120, 53, 15), toA = 0.6, border = hex("#92400e"), text = hex("#fcd34d"),
		pillText = hex("#fcd34d"), pillBg = rgb(69, 26, 3), pillBgA = 0.4, pillBorder = rgb(146, 64, 14), pillBorderA = 0.6,
		hl = hex("#c8a87c"), hlBorder = hex("#7c5a2e"), accent = hex("#ffd230"),
	},
	common = {
		from = rgb(63, 63, 70), fromA = 0.5, via = VIA, viaA = 1, to = rgb(63, 63, 70), toA = 0.5, border = hex("#52525b"), text = hex("#d1d5db"),
		pillText = hex("#d1d5db"), pillBg = VIA, pillBgA = 1, pillBorder = hex("#52525b"), pillBorderA = 1,
		hl = hex("#52525b"), hlBorder = hex("#a1a1aa"), accent = hex("#d1d5dc"),
	},
	uncommon = {
		from = rgb(6, 78, 59), fromA = 0.6, via = VIA, viaA = 1, to = rgb(6, 78, 59), toA = 0.6, border = hex("#065f46"), text = hex("#34d399"),
		pillText = hex("#34d399"), pillBg = rgb(2, 44, 34), pillBgA = 0.4, pillBorder = rgb(6, 95, 70), pillBorderA = 0.6,
		hl = hex("#6ee7b7"), hlBorder = hex("#059669"), accent = hex("#00d492"),
	},
	rare = {
		from = rgb(30, 58, 138), fromA = 0.6, via = VIA, viaA = 1, to = rgb(30, 58, 138), toA = 0.6, border = hex("#1e40af"), text = hex("#60a5fa"),
		pillText = hex("#60a5fa"), pillBg = rgb(23, 37, 84), pillBgA = 0.4, pillBorder = rgb(30, 64, 175), pillBorderA = 0.6,
		hl = hex("#93c5fd"), hlBorder = hex("#2563eb"), accent = hex("#51a2ff"),
	},
	epic = {
		from = rgb(88, 28, 135), fromA = 0.6, via = VIA, viaA = 1, to = rgb(88, 28, 135), toA = 0.6, border = hex("#6b21a8"), text = hex("#c084fc"),
		pillText = hex("#c084fc"), pillBg = rgb(59, 7, 100), pillBgA = 0.4, pillBorder = rgb(107, 33, 168), pillBorderA = 0.6,
		hl = hex("#c4b5fd"), hlBorder = hex("#7c3aed"), accent = hex("#c27aff"),
	},
	anomaly = {
		from = rgb(124, 45, 18), fromA = 0.6, via = VIA, viaA = 1, to = rgb(124, 45, 18), toA = 0.6, border = hex("#9a3412"), text = hex("#fb923c"),
		pillText = hex("#fb923c"), pillBg = rgb(67, 20, 7), pillBgA = 0.4, pillBorder = rgb(154, 52, 18), pillBorderA = 0.6,
		hl = hex("#fdba74"), hlBorder = hex("#ea580c"), accent = hex("#ff8904"),
	},
	mythic = {
		from = rgb(136, 19, 55), fromA = 0.55, via = rgb(88, 28, 135), viaA = 0.45, to = rgb(22, 78, 99), toA = 0.55, border = hex("#9d174d"), text = hex("#f3f4f6"),
		pillText = hex("#f87171"), pillBg = rgb(69, 10, 10), pillBgA = 0.4, pillBorder = rgb(157, 23, 77), pillBorderA = 0.6,
		hl = hex("#f9a8d4"), hlBorder = hex("#db2777"), accent = hex("#ff6467"),
	},
}

-- Plusieurs groupes de chiffres sous un même badge : une couleur par groupe.
Theme.groupColors = {
	{ hex("#93c5fd"), hex("#2563eb") },
	{ hex("#86efac"), hex("#059669") },
	{ hex("#fcd34d"), hex("#d97706") },
	{ hex("#f9a8d4"), hex("#db2777") },
}

-- Confettis par rareté de carte (mêmes quantités et couleurs que le site).
Theme.confetti = {
	epic = { count = 60, colors = { hex("#a855f7"), hex("#d8b4fe"), hex("#7c3aed"), hex("#f0abfc") } },
	anomaly = { count = 120, colors = { hex("#f97316"), hex("#fdba74"), hex("#fbbf24"), hex("#ea580c") } },
	mythic = { count = 240, colors = { hex("#ec4899"), hex("#a855f7"), hex("#22d3ee"), hex("#f43f5e"), hex("#fde047") } },
}

return Theme

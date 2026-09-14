# RNG∞

Jeu de nombre aléatoire **sans limite quotidienne**, inspiré de [rngdle.com](https://www.rngdle.com/).
Chaque tirage donne un nombre entre 0 et 1 000 000, analysé par 233 badges (palindromes, premiers, suites, nombres mèmes…) qui rapportent des EP.

## Ce qu'il y a en plus de l'original

- Tirages illimités (touche **Espace** pour relancer) ; comme sur l'original, ni les chiffres ni les badges ne se sautent
- **Historique** complet : recherche par nombre ou badge, filtre par rareté, tri par EP
- **Stats** : distribution des raretés vs cotes attendues, EP par tirage, fréquence des chiffres, séries sans Rare
- **Collection** des 233 badges avec compteur, premier tirage et cote de chaque badge
- Nombres déjà tirés signalés, badges nouveaux marqués **NEW**
- Export / import JSON de l'historique, 3 vitesses pour l'arrivée des badges, thème clair/sombre

## Fidélité au jeu d'origine

Le moteur (`js/engine.js`) est réécrit, puis validé par `tools/build.mjs` :

1. les 1 000 001 nombres possibles sont analysés, et le score de chaque badge dérivé de sa fréquence réelle
   (`100 × 1 000 001 / nb de nombres`) doit égaler le score de référence → **233/233**
2. les totaux EP de 96 vrais tirages relevés sur le leaderboard d'origine doivent tomber juste → **96/96**

La table des percentiles (rareté de carte, « TOP x % ») est calculée sur la même énumération.

## Lancer

Site statique, aucune dépendance :

```bash
python3 -m http.server 8123
```

Regénérer les données après modification du moteur :

```bash
node tools/build.mjs
```

## Leaderboard (à venir)

Les tirages étant illimités, le classement portera sur le **meilleur tirage** (jour / semaine / all-time) et non sur l'EP total.
`player.id` et `player.name` sont déjà stockés localement pour ça.

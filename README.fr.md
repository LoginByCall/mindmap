# Mind Map — un éditeur léger basé sur markmap

[Русский](README.md) · [English](README.en.md) · [Español](README.es.md) · **Français** · [Deutsch](README.de.md) · [中文](README.zh.md)

*Éditeur de cartes mentales léger et hors ligne pour Linux (GTK3 + WebKit2GTK, markmap) : Markdown, FreeMind, OPML, XMind, export PDF. MIT.*

Affichage et édition de cartes mentales sous Linux. GTK3 + WebKit2GTK (paquets système), avec à l’intérieur [markmap](https://github.com/markmap/markmap) 0.18.12 et d3 7.9.0, stockés localement dans `web/vendor/` : aucun réseau n’est nécessaire.

## Lancement

```sh
./mindmap.py [carte.mm.md|.mm|.opml|.xmind]
./mindmap.py carte.mm.md --pdf carte.pdf     # export sans interface
```

Dépendances (Debian/Ubuntu) : `python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1`.

## Installation

```sh
./build.sh [version]     # par défaut 0.3.1 → dist/mindmap_0.3.1_all.deb et dist/mindmap.run
sudo apt install ./dist/mindmap_0.3.1_all.deb
```

Le paquet installe la commande `mindmap`, le lanceur « Mind Map » dans le menu des applications, l’icône et les types de fichiers ; apt installe les dépendances.

`mindmap.run` est la même chose en un seul fichier, sans installation (sans lanceur ni types de fichiers) : au premier lancement il se déploie dans `~/.cache/mindmap/<hachage>/`, puis démarre aussitôt. GTK/WebKit n’y sont pas inclus : les paquets système de la liste ci-dessus sont nécessaires.

### Extension de fichier : `.mm.md`

Il est conseillé de nommer les cartes `plan.mm.md`, comme les nomme markmap (extension pour VS Code). C’est du Markdown ordinaire : GitHub l’affiche et n’importe quel éditeur l’ouvre, mais il a son propre type `text/x-markmap`, et un double-clic ouvre la carte. Les `.md` ordinaires restent à votre éditeur Markdown ; Mind Map est proposé pour eux dans « Ouvrir avec ». Par défaut, une nouvelle carte est enregistrée sous `mindmap.mm.md`.

Le paquet enregistre aussi `.mm` (FreeMind/Freeplane) et `.xmind` : ils ne figurent pas dans la base de types standard (`.mm` y désigne du troff). Pour faire de Mind Map l’application par défaut :

```sh
xdg-mime default mindmap.desktop text/x-markmap application/x-freemind application/vnd.xmind.workbook text/x-opml+xml
```

## Fonctionnalités

- Langues de l’interface, de l’aide et du tutoriel : russe, anglais, espagnol, français, allemand, chinois (simplifié). Choix selon la locale du système, anglais pour les autres ; pour forcer — `LANGUAGE=de mindmap`.
- Zoom : molette, pincement du pavé tactile, `Ctrl+=` / `Ctrl+-` ; `Ctrl+0` — ajuster à la fenêtre.
- Création et modification de la carte : sur le graphe (double-clic sur le titre ou la liste, menu contextuel, clavier) et dans la source Markdown (`Ctrl+E` — afficher/masquer). Les deux côtés sont synchronisés.
- Aide — `F1` ou « ? » ; « Fichier → Tutoriel » — carte d’apprentissage avec exercices à cocher.
- Modification du texte directement dans le nœud, sans champ séparé superposé.
- « Attrape et glisse » : une branche par son titre — sur le tiers supérieur d’une autre branche (insérer avant), le tiers inférieur (après) ou le milieu (en faire une branche enfant). Au bord du canevas (40 px), celui-ci défile tout seul. Esc annule, Ctrl+Z rétablit. Glisser le vide déplace le canevas.
- Liens : `[site](https://…)` — dans le navigateur ; `[fichier](./docs/devis.pdf)`, `[dossier](~/Documents)` — ouverture dans le gestionnaire de fichiers avec sélection (rien n’est exécuté) ; `[carte](reseau.md)` — s’ouvre ici ; `[voir](#nom-du-nœud)` — aller au nœud. Les chemins relatifs partent du dossier de la carte.
- On peut déposer un fichier ou un lien sur un nœud : une branche-lien enfant apparaît (image — `![](…)`).
- Listes numérotées selon CommonMark (`1.`, `1)`, le premier numéro est conservé) : « Branches : numérotation » et « Liste : numérotation » dans le menu de la branche, dans le champ de liste — « 1. » sur la première ligne. Il n’y a pas de listes alphabétiques en Markdown.
- Images `![](photo.jpg)` dans les nœuds, cases à cocher `- [ ] à faire` / `- [x] fait` (un clic bascule).
- Note sous le nœud — lignes `> texte`, liste — `> - élément`. Dans .mm/.opml/.xmind, la note et la liste sont stockées dans un seul champ.
- Menu « Fichier » : nouveau, ouvrir, enregistrer, enregistrer sous, exporter en PDF, quitter (`Ctrl+Q`, demande confirmation s’il reste des modifications non enregistrées).
- Liste sous le trait du nœud — en petits caractères, se réduit d’un clic sur ▾/▸. Elle se modifie dans un seul champ (double-clic sur la liste, `Shift+Enter` ou menu) : une ligne — un élément, `Shift+Enter` — nouvelle ligne, `Enter` — terminé, `Esc` — annuler. Les lignes vides sont ignorées, un champ vide supprime la liste.
- Menu contextuel de la branche : ajouter enfant/sœur, renommer, couleur (palette, personnalisée, réinitialisation), réduire, monter/descendre, remonter/descendre d’un niveau, copier/couper/coller, supprimer. Sur le vide : ajuster, tout développer/réduire, source, PDF.
- Clavier : `Tab`/`Enter` — enfant/sœur, `Shift+Enter` — liste sous le nœud, `F2` — modifier, `Del` — supprimer, `Espace` — réduire, flèches — navigation, `Alt+flèches` — déplacement, `Ctrl+Z`/`Ctrl+Y` — annuler/rétablir, `Ctrl+N/O/S/Shift+S/P/Q`.
- Formats : Markdown (`.mm.md`, `.md`), FreeMind/Freeplane (`.mm`, XML), OPML (`.opml`, XML), XMind 2020+ (`.xmind`). Le format à l’enregistrement dépend de l’extension.
- Export PDF : vectoriel, une page à la taille de la carte.

## Stockage en Markdown

La structure : titres, éléments de liste, paragraphes (comme dans markmap). La couleur de la branche — `<!-- color: #e15759 -->`, le repli — le commentaire markmap standard `<!-- markmap: fold -->`. La couleur est héritée par les descendants.

La liste sous un nœud est une citation placée juste sous la ligne du nœud (avec le retrait de l’élément) ; repliée, elle porte la marque `<!-- notes: fold -->` :

```markdown
## Objectifs <!-- notes: fold -->
> - échéance : mai
> - budget

- Premier objectif
  > - métrique : NPS > 40
  - sous-objectif
```

Le markmap ordinaire affichera cette citation comme un nœud enfant : le contenu n’est pas perdu.

## Limitations

- La modification sur le graphe ramène le Markdown à sa forme canonique (listes avec retrait de 2 espaces, lignes vides autour des titres). Un fichier modifié uniquement dans la source est enregistré octet pour octet.
- Dans `.mm`/`.opml`/`.xmind`, on conserve le texte, la hiérarchie, le repli (sauf OPML) et la couleur (sauf XMind). La liste sous un nœud est écrite comme une note : FreeMind `richcontent NOTE`, OPML `_note`, XMind `notes` ; son état replié n’est pas transmis à ces formats. La liste n’a qu’un seul niveau. Les icônes, notes, relations et styles des autres éditeurs sont perdus à la réécriture.
- XMind 8 (`content.xml`) n’est pas lu. L’ouverture d’un `.xmind` enregistré dans XMind lui-même n’a pas été vérifiée.
- Les formules KaTeX et la coloration du code sont désactivées (elles chargent des ressources depuis un CDN).
- Dans le PDF, seules les branches développées sont incluses.

## Vérifications

```sh
python3 test_formats.py      # .mm / .opml / .xmind, écriture sur disque
node web/mdtree.test.js      # Markdown ⇄ arbre
python3 tests/test_i18n.py   # traductions web/lang/*.json complètes, ancres des cartes valides
python3 tests/test_ui.py     # interface dans Chrome headless (événements synthétiques)
node tests/ui-input.mjs      # interface avec de vraies entrées souris (Chrome DevTools Protocol)
```

Débogage : `MINDMAP_DEBUG=1 ./mindmap.py` — inspecteur WebKit et `console.log` sur stdout.

## Licence

[MIT](LICENSE). Dans `web/vendor/` — markmap (MIT) et d3 (ISC), leurs licences se trouvent à côté.

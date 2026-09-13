# Pepino

Engine per giochi 2D pensato per chi non sa programmare. Si crea un oggetto, gli si dà una sprite e poi si aggiungono **blocchi** già pronti (controller platform, camera che segue, salute, danno, raccoglibili…) configurabili dall'Inspector, con parametri in tile e secondi. Chi programma può scrivere blocchi nuovi in JavaScript o in Python, direttamente nell'editor. I giochi si esportano per il web (WebGL).

L'analisi di partenza (confronto con gli altri engine, funzioni, architettura e roadmap) si trova in [docs/analisi.html](docs/analisi.html).

## Avvio

Serve Node.js 20.10 o superiore. Il progetto usa Electron 41: dalla versione 42 l'installer di Electron richiede Node 20.19+ (o 22.12+). Se aggiorni Node puoi passare a un Electron più recente.

```bash
npm install
npm run samples   # genera il progetto demo in samples/demo
npm run dev       # apre l'editor desktop (Electron)
```

Altri comandi:

| Comando | Cosa fa |
| --- | --- |
| `npm run dev:web` | Editor nel browser su http://localhost:5180 (senza salvataggio su file) |
| `npm run dev:player` | Solo il gioco: http://localhost:5181/?project=/demo/project.json |
| `npm run build` | Compila il player (`dist/player/pepino.js`) e l'app Electron (`out/`) |
| `npm run export:demo` | Esporta la demo come build WebGL in `dist/export/pepino-demo-web` |
| `npm test` | Test automatici: fisica, controller, combattimento, Regole, dialoghi, script, traduttore Python, editor, export |
| `npm run typecheck` | Controllo dei tipi TypeScript |

## Come si usa l'editor

- **Gerarchia** (a sinistra): scena aperta, layer di tile (occhio = visibile, lucchetto = bloccato, `collide` = conta per le collisioni) e oggetti.
- **Vista scena** (al centro): clic per selezionare, trascina per spostare (aggancio a mezzo tile, Alt per disattivarlo). Rotella = zoom, tasto destro o Spazio + trascina = sposta la vista.
- **Inspector** (a destra): proprietà dell'oggetto e dei suoi blocchi. «Aggiungi blocco» aggiunge anche i blocchi richiesti (es. il Controller Platform aggiunge il Corpo).
- **Tileset** (in basso): scegli un tile e dipingi con il pennello. Per ogni tile scegli cosa fa: muro/pavimento, attraversabile dal basso, scala, pericolo. Il pulsante **Collisioni** mostra questi colori sul livello.
- **Modelli**: oggetti riutilizzabili (come i Prefab di Unity). Trascinali nella scena; le modifiche al modello valgono per tutte le istanze.
- **Regole** (scheda accanto a Scena): la logica del gioco senza codice, scritta come frasi «Quando → Allora». Vedi sotto.
- **Codice**: blocchi nuovi scritti in JavaScript o Python. Vedi «Blocchi in codice».
- **Prova** (F5): avvia il gioco nell'editor con lo stesso runtime della build. Pausa, avanzamento di un frame, velocità, collisioni e variabili in tempo reale.
- **Esporta WebGL**: crea una cartella con `index.html`, `pepino.js`, `project.json` e gli asset, pronta per itch.io o un qualsiasi server web. Il gioco va aperto da un server (itch.io, `npx vite preview`…): aprendo `index.html` con doppio clic il browser blocca il caricamento dei file.
- **Controlla progetto** (pannello Console): cerca asset, scene, modelli e id inesistenti, blocchi mancanti e regole incomplete. Parte da solo quando premi Prova; clic su un messaggio per andare all'oggetto o alla regola.

Scorciatoie: `V` seleziona, `B` pennello, `E` gomma, `G` griglia, `C` collisioni, `Ctrl+Z`/`Ctrl+Y` annulla/ripeti, `Ctrl+D` duplica, `Canc` elimina, `Ctrl+S` salva.

## Blocchi disponibili

| Categoria | Blocco | Cosa fa |
| --- | --- | --- |
| Grafica | Sprite | Immagine o fotogramma di uno sprite sheet |
| Grafica | Animazioni per stato | Collega stati (fermo, corsa, salto…) ad animazioni; stesso nome = collegamento automatico |
| Fisica | Corpo | Box di collisione, gruppo e gruppi con cui interagisce |
| Movimento | Controller Platform | Corsa, salto con altezza in tile, doppio salto, coyote time, memoria del salto, dash, scale, piattaforme attraversabili |
| Movimento | Controller Top-down | 4 o 8 direzioni senza gravità |
| Camera | Camera che segue | Stile platform (anticipo), dall'alto o bloccata; zona morta, limiti della scena, scossa |
| IA | Pattuglia | Avanti e indietro, si gira contro i muri e sui bordi |
| Combattimento | Salute | Vita, invulnerabilità, contraccolpo, danno dai tile pericolo, cosa succede alla morte |
| Combattimento | Danno al contatto | Ferisce chi lo tocca; si può schiacciare saltandoci sopra |
| Gameplay | Raccoglibile | Aggiunge valore a una variabile (monete, punti…) |
| Gameplay | Uscita verso scena | Cambia scena con dissolvenza |
| Interfaccia | Testo | HUD o scritte nel mondo, con `{variabile}` |
| Interfaccia | Pulsante | Voce di menù: frecce, mouse o tocco; può portare a una scena |
| Interfaccia | Barra | Barra che si riempie in base a una variabile (vita, energia…) |
| Interfaccia | Rettangolo | Sfondi dei menù e riquadri colorati |
| IA | Insegue | Vede il bersaglio (i muri bloccano la vista) e lo insegue: salta gli ostacoli nei platform, trova la strada con A* nel top-down |
| Personaggi | Personaggio che parla | Vicino + Azione apre un dialogo; fumetto sopra la testa |
| Combattimento | Attacco corpo a corpo | Colpo davanti a sé con preparazione, colpo attivo e recupero |
| Combattimento | Spara | Lancia un proiettile (modello) quando premi un comando o da solo verso il bersaglio |
| Combattimento | Proiettile | Vola dritto o ad arco, ferisce, sparisce contro i muri |
| Gameplay | Generatore | Crea oggetti da un modello a intervalli, con un massimo |

## Dialoghi

Nella scheda **Dialoghi** (accanto a Scena e Regole) si scrivono le conversazioni: ogni battuta ha chi parla, un ritratto (un fotogramma di un'immagine) e il testo, con `{variabile}`. Una battuta può avere delle **scelte**: ognuna porta a un'altra battuta (o chiude il dialogo) e può impostare una variabile, da usare poi nelle Regole. Nel gioco il dialogo ferma l'azione; frecce per scegliere, Azione o Salto per andare avanti.

Si collegano a un personaggio con il blocco **Personaggio che parla**, oppure si avviano da una Regola («Avvia un dialogo»). La regola «Un dialogo finisce» serve a far succedere qualcosa dopo, come nella demo: se hai accettato la missione del Nonno Cetriolo, Pepino riceve il mestolo.

## Regole

Ogni regola si legge come una frase: **Quando** succede qualcosa, **e se** valgono delle condizioni, **allora** esegui delle azioni. Esempi dalla demo:

- Quando `#giocatore: È stato colpito` → scuoti lo schermo (3 px per 0,25 s)
- Quando il giocatore preme `Azione`, e se `#giocatore` sta toccando `Cartello` → mostra il messaggio «…» (ferma il gioco)
- Quando la scena inizia, e se **non** esiste una partita salvata → nascondi `Continua`

Gli oggetti si indicano per etichetta (`#nemico`, tutti quelli che la hanno), per nome (`Cartello`), come «questo oggetto» (quello dell'evento) o «l'altro oggetto» (per esempio chi è stato toccato).

| Quando | E se | Allora |
| --- | --- | --- |
| La scena inizia, ogni tot secondi, dopo tot secondi, in ogni momento | Confronta una variabile | Imposta / aggiungi a una variabile |
| Il giocatore preme un comando | Il giocatore tiene premuto un comando | Vai a un'altra scena, riavvia, attendi |
| Un oggetto tocca / smette di toccare un altro | Un oggetto sta toccando / è vicino a un altro | Crea da un modello, distruggi, sposta, mostra/nascondi |
| Succede qualcosa a un oggetto (eventi dei blocchi: ha saltato, è stato colpito, è morto, è stato raccolto, pulsante premuto…) | Un oggetto è in uno stato, condizione di un blocco, conta gli oggetti | Azione di un blocco (infliggi danno, cura, anima…), attiva/disattiva un blocco |
| | Probabilità, esiste una partita salvata | Suoni e musica, scuoti lo schermo, messaggio, salva/carica la partita |

Le regole della scena valgono solo lì; quelle **globali** valgono in tutte le scene. «Una volta sola» fa scattare la regola al massimo una volta per scena.

Nel gioco: `Esc` (o Start sul gamepad) mette in pausa; i messaggi compaiono in basso con l'effetto macchina da scrivere e si chiudono con Azione o Salto.

## Blocchi in codice

Quando i blocchi pronti non bastano, nella scheda **Codice** si scrive un blocco nuovo in **JavaScript** o in **Python**. Il blocco compare nell'Inspector («Aggiungi blocco» → Personalizzati) e le sue azioni, condizioni ed eventi compaiono nelle Regole, esattamente come quelli di Pepino. Il codice viene salvato dentro `project.json` e finisce anche nella build WebGL.

- Le modifiche si applicano da sole mentre scrivi; gli errori di scrittura vengono sottolineati, con la riga.
- Se uno script ha un errore, gli oggetti continuano a usare l'ultima versione che funzionava.
- Se un blocco va in errore a gioco avviato, si ferma solo quel blocco e la Console indica script e riga (clic per aprirlo).
- La demo ne ha due: **Fluttua** (JavaScript, fa ondeggiare il titolo del menù) e **Molla** (Python, la molla rossa nel livello 1, prima del muretto).

Ogni blocco dichiara proprietà, stati, condizioni, azioni ed eventi: l'editor li legge e genera l'Inspector da solo.

```js
Pepino.defineBlock({
  name: "Rimbalzo",
  label: "Rimbalzo sui nemici",
  props: {
    impulse: { type: "number", label: "Spinta", unit: "tile/s", default: 9, min: 0 },
    target: { type: "tag", label: "Etichetta", default: "nemico" },
  },
  events: [{ id: "bounced", label: "Ha rimbalzato" }],
  actions: {
    bounce: {
      label: "Rimbalza",
      run(self) {
        self.body.vy = -self.props.impulse * self.scene.tileSize;
        self.emit("bounced");
      },
    },
  },
  update(self, dt) {
    if (self.body?.touched(self.props.target, "bottom")) self.actions.bounce();
  },
});
```

Lo stesso in Python: le variabili del file diventano la definizione del blocco, le funzioni con i nomi `init`, `update`, `physics`, `late`, `destroy` sono i momenti in cui gira, e `actions`/`conditions` collegano altre funzioni alle Regole.

```python
name = "Rimbalzo"
label = "Rimbalzo sui nemici"
props = {
    "impulse": {"type": "number", "label": "Spinta", "unit": "tile/s", "default": 9, "min": 0},
    "target": {"type": "tag", "label": "Etichetta", "default": "nemico"},
}
events = [{"id": "bounced", "label": "Ha rimbalzato"}]
actions = {"bounce": "Rimbalza"}


def bounce(self):
    self.body.vy = -self.props.impulse * self.scene.tileSize
    self.emit("bounced")


def update(self, dt):
    if self.body and self.body.touched(self.props.target, "bottom"):
        bounce(self)
```

Cosa si trova in `self`:

| | |
| --- | --- |
| `self.props` | i valori scelti nell'Inspector |
| `self.data` | la memoria del blocco (timer, contatori…) |
| `self.entity` | l'oggetto: `x`, `y`, `visible`, `state`, `facingX`, `tags`, `get("Blocco")`, `destroy()` |
| `self.body` | il Corpo, se c'è: `vx`, `vy`, `onGround`, `touching("etichetta")` |
| `self.scene` | `tileSize`, `time`, `find("nome")`, `findAll("etichetta")`, `spawn("modello", x, y)` |
| `self.game` | `vars`, `audio.play("suono")`, `input.isDown("jump")`, `goToScene("id")` |
| `self.emit("evento")` | manda un evento che le Regole vedono in «Quando» |

**Il Python di Pepino** è una versione ridotta, tradotta in JavaScript mentre scrivi: il gioco esportato non contiene un interprete Python e resta leggero. Ci sono `if/elif/else`, `for` (anche con `range`), `while`, `def` con valori predefiniti e argomenti con nome, liste, dizionari, tuple, f-string, slice, `import math` e `import random`, `print()` (scrive nella Console). Non ci sono classi, `try/except`, `with`, `lambda`, comprehension e `global`: per ricordare valori tra un fotogramma e l'altro si usa `self.data`. Con il pulsante «JavaScript generato» si vede il codice che gira davvero.

## Struttura

```
src/runtime/   motore di gioco (TypeScript + WebGL2): loop, renderer, input, audio, collisioni, blocchi
src/player/    pagina del gioco esportato (diventa pepino.js)
src/main/      processo principale Electron (file, protocollo pepino://, export)
src/preload/   ponte sicuro tra Electron e l'editor
src/renderer/  editor (React)
scripts/       generatore del progetto demo (pixel art, suoni e livelli creati da codice)
samples/demo/  progetto demo: livello platform + villaggio top-down
docs/          analisi iniziale
```

## Stato e prossimi passi

Fatto: runtime (fase 0), editor di base (fase 1), primi blocchi con anteprima ed export (fase 2), Regole, menù, messaggi, pausa e salvataggi (fase 3), nemici che inseguono e sparano, attacchi, generatori, dialoghi con scelte e ritratti (fase 4), blocchi in codice JavaScript e Python con editor integrato (fase 5).

Prossimi passi, secondo la roadmap in `docs/analisi.html`:

1. Luci 2D, particelle, shader, beat 'em up con asse z, controlli touch, autotile.
2. Script in TypeScript e completamento automatico dell'API nell'editor del codice.

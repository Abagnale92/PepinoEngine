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
- **Testi**: tutti i testi del gioco in una tabella, con una colonna per ogni lingua in cui tradurli. Vedi «Lingue e traduzioni».
- **Codice**: blocchi nuovi scritti in JavaScript o Python. Vedi «Blocchi in codice».
- **Nuovo** (barra in alto): crea un progetto da un modello di genere, platform, top-down, beat 'em up, shoot'em up o tower defense, già giocabile. Nell'app desktop chiede una cartella vuota e copia gli asset.
- **Impostazioni della scena** (Inspector senza selezione): luci 2D con il colore della luce ambiente, effetto a tutto schermo; nella sezione Progetto i controlli touch.
- **Prova** (F5): avvia il gioco nell'editor con lo stesso runtime della build. Pausa, avanzamento di un frame, velocità, collisioni e variabili in tempo reale.
- **Esporta WebGL**: crea una cartella con `index.html`, `pepino.js`, `project.json` e gli asset, pronta per itch.io o un qualsiasi server web. Il gioco va aperto da un server (itch.io, `npx vite preview`…): aprendo `index.html` con doppio clic il browser blocca il caricamento dei file.
- **Controlla progetto** (pannello Console): cerca asset, scene, modelli e id inesistenti, blocchi mancanti e regole incomplete. Parte da solo quando premi Prova; clic su un messaggio per andare all'oggetto o alla regola.
- **Impostazioni** (ingranaggio nella barra in alto): lingua dell'editor (italiano o inglese), tema scuro o chiaro, dimensione dell'interfaccia, salvataggio automatico, colore e opacità della griglia, aggancio a mezzo tile o a tile intero, controllo del progetto prima di Prova, velocità e collisioni all'avvio dell'anteprima, dimensione del carattere nel codice, elenco delle scorciatoie. Si salvano sul computer e valgono per tutti i progetti.
- **Disegno** (scheda accanto a Codice): editor di pixel art per sprite, tile e sfondi. Vedi «Disegno».
- **Musica**: brani chiptune ed effetti sonori a 8 bit, creati senza file audio. Vedi «Musica».
- **Filmati**: scene animate fatte di passi (spostamenti, camera, dialoghi, dissolvenze). Vedi «Filmati».

Scorciatoie: `V` seleziona, `B` pennello, `E` gomma, `G` griglia, `C` collisioni, `Ctrl+Z`/`Ctrl+Y` annulla/ripeti, `Ctrl+D` duplica, `Canc` elimina, `Ctrl+S` salva.

## Blocchi disponibili

| Categoria | Blocco | Cosa fa |
| --- | --- | --- |
| Grafica | Sprite | Immagine o fotogramma di uno sprite sheet |
| Grafica | Animazioni per stato | Collega stati (fermo, corsa, salto…) ad animazioni; stesso nome = collegamento automatico |
| Fisica | Corpo | Box di collisione, gruppo e gruppi con cui interagisce |
| Movimento | Controller Platform | Corsa, salto con altezza in tile, doppio salto, coyote time, memoria del salto, dash, scale, piattaforme attraversabili |
| Movimento | Controller Top-down | 4 o 8 direzioni senza gravità |
| Camera | Camera che segue | Stile platform (anticipo), dall'alto, beat 'em up (solo orizzontale, può non tornare indietro), a stanze o bloccata; zona morta, limiti della scena, scossa, blocco dell'arena |
| Camera | Scorrimento automatico | Lo schermo avanza da solo in una direzione a velocità costante fino alla fine della scena (shoot'em up, runner); l'oggetto che lo porta viaggia con lo schermo |
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
| Combattimento | Spara | Lancia un proiettile (modello) quando premi un comando (anche di continuo, tenendolo premuto) o da solo verso il bersaglio; mira verso il bersaglio, dove guarda o in una direzione fissa; più proiettili a ventaglio |
| Combattimento | Proiettile | Vola dritto o ad arco, ferisce, sparisce contro i muri |
| Gameplay | Generatore | Crea oggetti da un modello a intervalli, con un massimo |
| Movimento | Controller Beat 'em up | Cammina avanti e in profondità, salta su un terzo asse con l'ombra a terra |
| Movimento | Controller Navicella | 8 direzioni per shoot'em up, rallentamento di precisione, non esce dallo schermo ed è trascinata dallo scorrimento |
| Movimento | Traiettoria | Movimento da solo: dritto, a onda, in picchiata verso il bersaglio o in cerchio; parte quando entra nello schermo e sparisce quando ne esce |
| IA | Punto del percorso | Tappa numerata di un percorso con nome; nel gioco non si vede |
| IA | Segue un percorso | Cammina lungo i punti del percorso in ordine; alla fine sparisce, ricomincia il giro o si ferma |
| Gameplay | Piazzola | Con un clic o un tocco costruisce un modello (una torretta) se la variabile dei soldi basta; mostra il costo |
| Gameplay | Ondate | Nemici a ondate sempre più numerose, con pausa, nemico speciale ogni tanto e numero dell'ondata in una variabile; avvisa quando sono finite |
| Movimento | Controller Auto | Guida vista dall'alto: gas, freno e retromarcia, sterzo; la sprite ruota con l'auto, derapa con poca aderenza e rallenta fuori dal layer della pista |
| Gameplay | Traguardo | Linea d'arrivo (numero 0) o punto di passaggio numerato di una pista |
| Gameplay | Giri | Conta i giri passando dai Traguardi in ordine; tempo, giro migliore e posizione in classifica nelle variabili |
| Effetti | Particelle | Polvere, scintille, fumo: di continuo o a raffica quando succede qualcosa (colpo, salto, morte) |
| Effetti | Luce | Torce e lampioni: illuminano quando la scena ha la luce ambiente; colore, raggio, tremolio |
| Effetti | Effetti animati | Come JuiceFX: la sprite si schiaccia, si allunga, lampeggia, trema, appare e sparisce con stile, galleggia o pulsa, lascia una scia di immagini fantasma. Parte da un evento o gira sempre |
| Combattimento | Combo di colpi | Premendo più volte l'attacco escono colpi diversi (pugno, pugno, calcio finale che manda a terra), colpo in aria, scia del colpo, stelline d'impatto e fermo d'immagine |
| IA | Boss | Nemico finale a stati: si sveglia, alterna carica, salto e schiacciata, raffica di proiettili, aiutanti; dopo ogni attacco è stanco; fasi al 60% e al 30% di vita; barra della vita in alto |

## Dialoghi

Nella scheda **Dialoghi** (accanto a Scena e Regole) si scrivono le conversazioni: ogni battuta ha chi parla, un ritratto (un fotogramma di un'immagine) e il testo, con `{variabile}`. Una battuta può avere delle **scelte**: ognuna porta a un'altra battuta (o chiude il dialogo) e può impostare una variabile, da usare poi nelle Regole. Nel gioco il dialogo ferma l'azione; frecce per scegliere, Azione o Salto per andare avanti.

Si collegano a un personaggio con il blocco **Personaggio che parla**, oppure si avviano da una Regola («Avvia un dialogo»). La regola «Un dialogo finisce» serve a far succedere qualcosa dopo, come nella demo: se hai accettato la missione del Nonno Cetriolo, Pepino riceve il mestolo.

## Lingue e traduzioni

I testi si scrivono normalmente, nella propria lingua. Nella scheda **Testi** si aggiungono le altre lingue (inglese, spagnolo, francese… o una qualsiasi con il suo codice): Pepino raccoglie da solo tutto quello che il giocatore vede, cioè Testi, Pulsanti, fumetti dei personaggi, messaggi delle Regole, battute e scelte dei dialoghi e il menù di pausa, e accanto a ogni testo c'è una casella per la traduzione. Non ci sono codici da inventare: la traduzione è legata al testo originale. Se un testo cambia, **Controlla progetto** segnala quante traduzioni mancano; quelle rimaste senza testo si tolgono con un clic.

Nel gioco la prima volta si sceglie da sola la lingua del browser, poi quella scelta dal giocatore viene ricordata. Le Regole hanno «Cambia lingua», «Passa alla lingua successiva» e la condizione «La lingua è». Nell'anteprima c'è un selettore della lingua. La demo è tradotta in inglese: nel menù c'è il pulsante «Lingua».

L'editor stesso è in italiano o in inglese (Impostazioni → Lingua dell'editor): cambiano menù, pannelli, nomi e descrizioni dei blocchi, frasi delle Regole e messaggi del controllo del progetto. I nomi scelti da chi crea il gioco (oggetti, scene, variabili) restano come sono. Le traduzioni dell'editor sono in `src/renderer/src/en/`; il test `tests/editor-en.test.ts` fallisce se un testo nuovo non ha l'inglese.

## Caratteri

I blocchi Testo e Pulsante hanno il campo **Carattere**; il **Carattere del gioco** (Inspector della scena → Progetto) vale per messaggi, dialoghi, pausa e per i testi che non ne scelgono uno. Caratteri pronti:

- **Pixel**, **Pixel grassetto** e **Pixel piccolo**: disegnati punto per punto, restano nitidi come la pixel art. Hanno lettere accentate, « », frecce ← → ↑ ↓, ▶ ▼ e ♥; un testo con lettere che non conoscono (per esempio in giapponese) passa da solo al carattere Moderno.
- **Moderno**, **Classico** e **Macchina da scrivere**: caratteri del sistema.

Con **Importa…** nel pannello Asset si aggiungono file `.ttf`, `.otf`, `.woff` o `.woff2`: compaiono nell'elenco dei caratteri con il nome dell'asset e vengono copiati nella build. Il Testo ha anche l'opzione **Contorno**, un bordo scuro che rende le scritte leggibili su qualsiasi sfondo.

## Disegno

La scheda **Disegno** è un piccolo editor di pixel art, sul modello di Aseprite. Si parte da un disegno nuovo (8×8 fino a 64×64, o una misura qualsiasi fino a 512) oppure da un'immagine del progetto: nell'Inspector di un asset immagine c'è **Modifica nel Disegno**, e nel pannello Asset c'è **Disegna…**.

- **Strumenti**: matita (B), gomma (E), secchiello (G), linea (L), rettangolo (R), ellisse (O), contagocce (I o Alt), sposta (M). Pennello da 1 a 8 pixel (`[` e `]`), disegno a specchio sinistra-destra e sopra-sotto, forme vuote o piene, rifletti e svuota il livello.
- **Colori**: clic sinistro = colore principale, clic destro = secondario (X li scambia). Tavolozze pronte (PICO-8, Pepino, Sweetie 16, Game Boy, grigi) più i colori messi da parte per il disegno.
- **Livelli**: aggiungi, nascondi, rinomina, sposta, unisci a quello sotto.
- **Fotogrammi**: aggiungi, duplica, sposta ed elimina; `,` e `.` passano da uno all'altro; **Cipolla** mostra in trasparenza il fotogramma prima; l'anteprima fa girare l'animazione agli fps scelti.
- Ctrl+Z / Ctrl+Y annullano i tratti del disegno; rotella = zoom; tasto centrale o Spazio + trascina = sposta la vista.

**Salva immagine** (o Ctrl+S nella scheda) scrive in `assets/` uno sprite sheet PNG con i fotogrammi in fila, il fotogramma 0 a sinistra, e un file `.pixel.json` con livelli e fotogrammi per riaprirlo. Se l'asset è nuovo lo aggiunge al progetto; con più fotogrammi imposta la griglia dello sprite sheet e, se mancano, crea un'animazione. Scena, anteprima e miniature si aggiornano da sole. Nel browser (`npm run dev:web`) il disegno resta solo in memoria.

## Musica

Nella scheda **Musica** si creano suoni senza bisogno di file: diventano suoni del progetto, da scegliere come **Musica** della scena, nelle Regole («Suona un effetto», «Cambia la musica») e nei campi audio dei blocchi (suono salto, suono moneta…). Sono salvati dentro `project.json` e il gioco li calcola all'avvio con un piccolo sintetizzatore, quindi funzionano anche nella build WebGL.

- **Brano**: quattro canali come nelle console a 8 bit, cioè Melodia, Armonia, Basso e Batteria. Si scrive sul piano roll: clic per aggiungere una nota, trascina per allungarla, clic destro per cancellarla. Le note degli altri canali si vedono in trasparenza. Ogni canale ha la sua onda (quadra, impulso 25% e 12%, triangolo, dente di sega, sinusoide, rumore), il volume, l'attacco e il rilascio; la batteria ha cassa, rullante, charleston e piatto. Per il brano si scelgono BPM, numero di battute, loop ed eco, che dà il suono più pieno dei giochi a 16 bit.
- **Effetto**: come sfxr. I pulsanti Moneta, Salto, Colpo, Esplosione, Potenziamento, Laser, Blip e Caduta creano ogni volta un effetto nuovo di quel tipo; poi lo si ritocca con i cursori (frequenza iniziale e finale, salita, tenuta, sfumatura, vibrato, salto di nota, suono «sporco»). Ogni modifica si ascolta subito.

## Filmati

Un filmato è una scena animata: i personaggi si spostano, la camera li inquadra, parlano, lo schermo sfuma al nero. Nella scheda **Filmati** si scrive come un elenco di **passi** eseguiti uno dopo l'altro. I passi sono le stesse azioni delle Regole (suoni, variabili, animazioni, cambi di scena…), più quelle della categoria **Filmati**, che aspettano di aver finito prima di passare alla successiva:

- **Porta un oggetto in un punto** (dove si trova un altro oggetto) e **Sposta un oggetto di qualche tile**, in un tempo scelto;
- **Sposta la camera su un oggetto** e **La camera torna a seguire**;
- **Dialogo e aspetta la fine**, **Messaggio e aspetta**;
- **Dissolvenza al nero** e **Torna dal nero**, **Barre del cinema**;
- **Attendi**, già presente nelle Regole, per le pause.

Mentre un filmato scorre il giocatore non comanda il personaggio (dialoghi e messaggi rispondono ancora ai tasti), e le barre nere del cinema entrano da sole se l'opzione è attiva. Con **Esc** (o Start) il giocatore lo salta, se il filmato lo permette: gli spostamenti arrivano subito a destinazione e i passi rimasti si eseguono senza dialoghi né messaggi. Un filmato parte con la Regola **Avvia un filmato**; quando finisce scatta l'evento **Un filmato finisce**, e c'è la condizione **È in corso un filmato**. La Regola **Blocca i comandi del giocatore** blocca i comandi anche fuori dai filmati.

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
| | La lingua è | Cambia la luce ambiente, effetto a tutto schermo, cambia lingua |

Le regole della scena valgono solo lì; quelle **globali** valgono in tutte le scene. «Una volta sola» fa scattare la regola al massimo una volta per scena.

Nel gioco: `Esc` (o Start sul gamepad) mette in pausa; i messaggi compaiono in basso con l'effetto macchina da scrivere e si chiudono con Azione o Salto.

## Generi, luci ed effetti

- **Beat 'em up**: il blocco «Controller Beat 'em up» cammina su un piano (avanti/indietro e profondità della strada) e salta su un terzo asse: lo sprite sale, il corpo e l'ombra («Ombra a terra» nello Sprite) restano sulla strada, e i colpi valgono solo tra chi è alla stessa profondità e altezza. Nella scena va attivato «Ordina per Y». La camera «Beat 'em up» scorre solo in orizzontale, «Non torna indietro» la fa solo avanzare, e con l'azione «Blocca la camera» più «L'oggetto non esce dallo schermo» si fanno le arene a ondate. L'«Attacco corpo a corpo» in modalità «Da solo» colpisce quando il bersaglio è a portata: basta per i nemici. Per il giocatore c'è la «Combo di colpi»: ogni colpo è uno stato (`attack1`, `attack2`, `attack3`, `airAttack`) che l'Animatore collega all'animazione con lo stesso nome; il tasto premuto durante un colpo viene ricordato, e i colpi forti mandano a terra (il nemico vola, resta steso e si rialza). In fondo alla strada della demo c'è il Capo dei teppisti, un «Boss» con tre fasi.
- **Camera a stanze**: passa da uno schermo all'altro (stile Zelda) e manda l'evento «Entra in un'altra stanza» alle Regole.
- **Luci 2D**: nelle impostazioni della scena si attiva la luce ambiente (il colore del buio); gli oggetti con il blocco «Luce» illuminano intorno a sé. Le Regole possono cambiare la luce ambiente (giorno → notte).
- **Effetti a tutto schermo**: vignetta, vecchio televisore (CRT), Game Boy, bianco e nero, seppia, con l'intensità. Si scelgono per scena o da una Regola.
- **Controlli touch**: su telefoni e tablet il gioco esportato mostra joystick e fino a 4 pulsanti (si scelgono nella sezione Progetto). Aggiungendo `&touch` all'indirizzo del gioco si provano anche da PC; nell'anteprima c'è il pulsante «Touch».
- **Modelli di progetto**: «Nuovo» crea un gioco piccolo ma completo per genere. Anche la demo ha la «Strada dei teppisti», un beat 'em up di notte con lampioni, scintille e due arene: la porta in fondo al villaggio ci porta dentro.
- **Shoot'em up**: il modello «Nello spazio» è uno sparatutto a scorrimento verticale. Un oggetto con **Scorrimento automatico** fa salire lo schermo e porta con sé le stelle (Particelle); la navicella ha il **Controller Navicella** e **Spara** verso l'alto tenendo premuto Z. Le ondate di ufo, caccia in picchiata e ufo che sparano usano **Traiettoria** e partono quando entrano nello schermo; in cima aspetta un'astronave madre che spara a ventaglio. Musica ed effetti sonori sono creati con la scheda Musica, i punti con una Regola.
- **Tower defense**: nel modello «Difesa del villaggio» gli slime arrivano a **Ondate** e con **Segue un percorso** camminano lungo i **Punti del percorso** del sentiero. Cliccando una **Piazzola** si costruisce una torretta per 20 monete; la torretta ha **Spara** in automatico verso il nemico più vicino. Le Regole danno 5 monete per ogni slime sconfitto, tolgono vita a chi arriva in fondo, fanno ricominciare quando la vita finisce e portano alla fine quando le ondate sono respinte.
- **Corse 2D**: nel modello «Gran premio dei cetrioli» l'auto ha il **Controller Auto** (↑ gas, ↓ freno, ← → sterzo) e rallenta sull'erba, cioè dove il layer «Pista» non ha tile. La linea d'arrivo e tre punti della pista sono **Traguardi**; il blocco **Giri** li conta in ordine e scrive giro, tempo, giro migliore e posizione nelle variabili dell'HUD. I tre avversari usano **Segue un percorso** con «Ruota verso dove va» e «Parte da solo» spento: una Regola blocca i comandi, fa il conto alla rovescia e poi dà il via a tutti con «Azione di un blocco → Riparti».

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

Fatto: runtime (fase 0), editor di base (fase 1), primi blocchi con anteprima ed export (fase 2), Regole, menù, messaggi, pausa e salvataggi (fase 3), nemici che inseguono e sparano, attacchi, generatori, dialoghi con scelte e ritratti (fase 4), blocchi in codice JavaScript e Python con editor integrato (fase 5), beat 'em up con asse dell'altezza, camera a stanze, luci 2D, particelle, effetti a tutto schermo, controlli touch, traduzioni in più lingue e modelli di progetto per genere (fase 6), combo animate, reazioni ai colpi, boss a stati ed effetti animati in stile JuiceFX (fase 7), editor in inglese e finestra Impostazioni (fase 8), caratteri Pixel, di sistema e importati per i testi del gioco (fase 9), editor di pixel art con livelli, fotogrammi e tavolozze (fase 10), brani chiptune ed effetti sonori creati nell'editor (fase 11), filmati con spostamenti, camera, dialoghi e dissolvenze (fase 12).

Prossimi passi:

1. Autotile per dipingere i livelli più in fretta.
2. Anteprima di luci ed effetti direttamente nella vista scena dell'editor.
3. Script in TypeScript e completamento automatico dell'API nell'editor del codice.

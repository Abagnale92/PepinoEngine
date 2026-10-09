# Pepino

Engine per giochi 2D pensato per chi non sa programmare. Si crea un oggetto, gli si dà una sprite e poi si aggiungono **blocchi** già pronti (controller platform, camera che segue, salute, danno, raccoglibili…) configurabili dall'Inspector, con parametri in tile e secondi. Chi programma può scrivere blocchi nuovi in **Pepino Language** (il linguaggio di Pepino, in italiano o in inglese), in JavaScript o in Python, direttamente nell'editor. I giochi si esportano per il web (WebGL).

L'analisi di partenza (confronto con gli altri engine, funzioni, architettura e roadmap) si trova in [docs/analisi.html](docs/analisi.html).

## Avvio

Serve Node.js 20.10 o superiore. Il progetto usa Electron 41: dalla versione 42 l'installer di Electron richiede Node 20.19+ (o 22.12+). Se aggiorni Node puoi passare a un Electron più recente.

```bash
npm install
npm run samples   # genera i modelli di progetto (samples/templates) con i loro asset
npm run dev       # apre l'editor desktop (Electron)
```

Altri comandi:

| Comando | Cosa fa |
| --- | --- |
| `npm run dev:web` | Editor nel browser su http://localhost:5180 (senza salvataggio su file) |
| `npm run dev:player` | Solo il gioco: http://localhost:5181/?project=/templates/platform.json (o un altro progetto dentro `samples/`) |
| `npm run build` | Compila il player (`dist/player/pepino.js`) e l'app Electron (`out/`) |
| `npm run export:sample -- <id>` | Esporta un gioco di esempio (`samples/<id>/project.json`) come build WebGL in `dist/export` |
| `npm test` | Test automatici: fisica, controller, combattimento, Regole, dialoghi, script, Pepino Language, traduttore Python, editor, export |
| `npm run pepino -- esegui file.pep` | Pepino Language fuori dall'engine: `esegui`, `controlla`, `prova`, `traduci`, `js`, `nuovo` (vedi sotto) |
| `npm run build:pepino` | Costruisce il comando `pepino` in `dist/pepino/pepino.mjs` (con `npm link` si usa ovunque) |
| `npm run typecheck` | Controllo dei tipi TypeScript |

## Giochi di esempio

L'editor ha un menu **Esempi** per aprire giochi completi fatti con Pepino. Un esempio è una cartella `samples/<id>/` con il suo `project.json`, generata da un `scripts/<nome>/build.mjs` che esporta `example` (`{ id, name: { it, en }, description: { it, en } }`) e una funzione `build()`. `npm run samples` esegue tutti i generatori che trova e scrive l'indice `samples/esempi.json`; senza esempi il menu non compare. Un esempio si esporta con `npm run export:sample -- <id>`.

## Come si usa l'editor

- **Gerarchia** (a sinistra): scena aperta, layer di tile (occhio = visibile, lucchetto = bloccato, `collide` = conta per le collisioni) e oggetti.
- **Vista scena** (al centro): clic per selezionare, trascina per spostare (aggancio a mezzo tile, Alt per disattivarlo). Rotella = zoom, tasto destro o Spazio + trascina = sposta la vista. Gli angoli di un oggetto con uno Sprite si trascinano per ridimensionarlo (Maiusc = in proporzione): cambia la **Scala** dell'oggetto, che ingrandisce anche il corpo di collisione e si può scrivere anche nell'Inspector.
- **Asset** (in basso): immagini, suoni e caratteri del progetto. Si trascinano nella scena (le immagini) o nei campi dei blocchi; il cestino sulla scheda o **Elimina asset** nell'Inspector li toglie dal progetto (se sono usati lo chiede e svuota quei campi; il file resta nella cartella).
- **Campi Immagine, Suono, Modello e Oggetto** dei blocchi: clic per cercare per nome (con le miniature), oppure si trascina lì un asset, un modello o un oggetto.
- **Inspector** (a destra): proprietà dell'oggetto e dei suoi blocchi. «Aggiungi blocco» aggiunge anche i blocchi richiesti (es. il Controller Platform aggiunge il Corpo).
- **Tileset** (in basso): scegli un tile e dipingi con il pennello. Per ogni tile scegli cosa fa: muro/pavimento, attraversabile dal basso, scala, pericolo. Il pulsante **Collisioni** mostra questi colori sul livello.
- **Modelli**: oggetti riutilizzabili (come i Prefab di Unity). Trascinali nella scena; le modifiche al modello valgono per tutte le istanze.
- **Regole** (scheda accanto a Scena): la logica del gioco senza codice, scritta come frasi «Quando → Allora». Vedi sotto.
- **Testi**: tutti i testi del gioco in una tabella, con una colonna per ogni lingua in cui tradurli. Vedi «Lingue e traduzioni».
- **Codice**: blocchi nuovi scritti in Pepino Language, JavaScript o Python. Vedi «Blocchi in codice» e «Pepino Language».
- **Nuovo** (barra in alto): crea un progetto vuoto (una scena da dipingere, con il tileset e le immagini di base) oppure da un modello di genere già giocabile: platform, top-down, beat 'em up, shoot'em up, tower defense, corse 2D, punta e clicca, prima persona, picchiaduro 1 contro 1, roguelike, gioco di carte, horror, gioco a ritmo. Nell'app desktop chiede una cartella vuota e copia gli asset.
- **Oggetti**: l'archivio degli oggetti del gioco (pozioni, chiavi, potenziamenti…). Vedi «Oggetti, inventario, potenziamenti e negozio».
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
| Camera | Camera che segue | Anticipo nella direzione di corsa, morbida in tutte le direzioni, solo orizzontale (può non tornare indietro), a stanze o bloccata; zona morta, limiti della scena, scossa, blocco dell'arena |
| Camera | Scorrimento automatico | Lo schermo avanza da solo in una direzione a velocità costante fino alla fine della scena; l'oggetto che lo porta viaggia con lo schermo |
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
| Movimento | Cammina dove clicchi | Il personaggio va dove clicchi o tocchi: visto di lato solo a destra e sinistra, visto dall'alto gira intorno ai muri; arrivato su un Punto cliccabile lo usa |
| Gameplay | Punto cliccabile | Zona con un nome che compare sotto il puntatore: descrizione, evento per le Regole, oggetto da raccogliere o che chiede un oggetto dell'inventario |
| Interfaccia | Inventario | Barra degli oggetti con le quantità: Q usa l'oggetto scelto, E passa al successivo, un clic lo usa; con «Cammina dove clicchi» si sceglie l'oggetto e si usa cliccando un punto della scena |
| Gameplay | Oggetto da raccogliere | Un oggetto dell'archivio nella scena: toccandolo va nell'inventario, o fa subito effetto (cure, munizioni, potenziamenti) |
| Gameplay | Potenziamenti | Potenziamenti a tempo sul giocatore: velocità, super salto, invincibilità, più forza, calamita, scudo, salto in più; tempo rimasto sullo schermo |
| Gameplay | Negozio | Un venditore: vicino si preme Azione (o si clicca) e si apre la finestra per comprare gli oggetti con le monete; il gioco resta fermo |
| Movimento | Controller prima persona | Cammina e gira in prima persona (↑ ↓ avanti e indietro, ← → gira, Dash + ← → passo laterale) su una scena costruita vista dall'alto |
| Camera | Vista in prima persona | Disegna il gioco dagli occhi del giocatore: i tile solidi diventano muri, gli oggetti con uno Sprite figure rivolte verso chi guarda; mappa e mirino |
| Combattimento | Armi in prima persona | Le armi in mano nella vista in prima persona: una riga per arma (immagine, danno, munizioni, sblocco), colpo al centro del mirino e cambio arma animato |
| Movimento | Controller Picchiaduro | Uno contro uno: i due si guardano sempre, avanti e indietro a velocità diverse, salto, abbassata e parata tenendo indietro |
| IA | Avversario 1 contro 1 | Il computer nello scontro uno contro uno: si avvicina, colpisce a tiro, indietreggia, para o salta |
| Gameplay | Regia dell'incontro | Round, tempo, vittorie, barre della vita con i nomi e gli annunci «Round 1», «K.O.» e chi ha vinto |
| Gameplay | Sotterraneo a caso | Costruisce stanze e corridoi nel layer che collide, mette il giocatore, l'uscita e i modelli scelti; più si scende, più cose compaiono |
| Gameplay | Scala per il piano dopo | Aumenta la variabile del piano e ricarica la scena: con il Sotterraneo a caso è un livello nuovo |
| Interfaccia | Minimappa | Mappa della scena in un angolo: muri, l'oggetto che la porta e i segnalini di chi ha l'etichetta scelta |
| Gameplay | Duello a carte | Scontro a turni con mazzo, mano, energia, scudi e mosse dell'avversario; le carte imparate restano in una variabile |
| Effetti | Torcia | Fascio di luce davanti a sé con alone, comando per accenderla e batteria che si consuma |
| IA | Ti cerca al buio | Vaga, sente i rumori, vede in un cono e dà la caccia; chi è nascosto non lo trova |
| Gameplay | Coraggio | Barra che cala al buio e vicino al mostro e risale nella luce; sotto la soglia lo schermo pulsa |
| Gameplay | Nascondiglio | Armadi e cespugli: con Azione ci si nasconde dentro, invisibili a chi cerca |
| Gameplay | Note a tempo | Note che scendono su corsie verso la linea: Perfetto, Bene, Mancata, combo e punteggio nelle variabili |
| Effetti | Particelle | Polvere, scintille, fumo: di continuo o a raffica quando succede qualcosa (colpo, salto, morte) |
| Effetti | Luce | Torce e lampioni: illuminano quando la scena ha la luce ambiente; colore, raggio, tremolio |
| Effetti | Effetti animati | La sprite si schiaccia, si allunga, lampeggia, trema, appare e sparisce con stile, galleggia o pulsa, lascia una scia di immagini fantasma. Parte da un evento o gira sempre; nell'Inspector un'anteprima mostra subito l'effetto scelto |
| Combattimento | Combo di colpi | Premendo più volte l'attacco escono colpi diversi (pugno, pugno, calcio finale che manda a terra), colpo in aria, scia del colpo, stelline d'impatto e fermo d'immagine |
| IA | Boss | Nemico finale a stati: si sveglia, alterna carica, salto e schiacciata, raffica di proiettili, aiutanti; dopo ogni attacco è stanco; fasi al 60% e al 30% di vita; barra della vita in alto |
| Personaggi | Fuggitivo | Scappa e raccoglie caramelle e bonus (torcia, caramella turbo, mantello, zucca esplosiva, chiave); se il Cacciatore lo prende diventa un fantasma che passa nei muri, infesta le cose e fa «Buh!». Lo comanda un giocatore con i suoi tasti o il computer |
| Personaggi | Cacciatore | Insegue e prende i Fuggitivi toccandoli; scatto con Azione, stordito da torcia e trappole, più lento nella luce; il computer ricorda dove ha visto qualcuno |
| Gameplay | Bonus da raccogliere | Caramella (conto della squadra) o bonus a terra per i Fuggitivi; può ricomparire dopo qualche secondo |
| Gameplay | Infestabile | Luce da spegnere, cancello da chiudere (anche chiuso a chiave), oggetto da spostare o qualcosa che spaventa: lo usano i fantasmi, poi torna com'era |
| Gameplay | Trappola | Si arma e scatta quando passa un Cacciatore: lo stordisce con un'esplosione |
| Gameplay | Partita a squadre | Caramelle da raccogliere insieme, tempo, uscita, HUD con una scheda per personaggio, conto alla rovescia e risultati |
| Interfaccia | Scelta dei personaggi | Da 1 a 4 giocatori entrano con il loro tasto Azione e scelgono; i posti liberi vanno al computer; scrive chi comanda chi nelle variabili |

## Dialoghi

Nella scheda **Dialoghi** (accanto a Scena e Regole) si scrivono le conversazioni: ogni battuta ha chi parla, un ritratto (un fotogramma di un'immagine) e il testo, con `{variabile}`. Una battuta può avere delle **scelte**: ognuna porta a un'altra battuta (o chiude il dialogo) e può impostare una variabile, da usare poi nelle Regole. Nel gioco il dialogo ferma l'azione; frecce per scegliere, Azione o Salto per andare avanti.

Si collegano a un personaggio con il blocco **Personaggio che parla**, oppure si avviano da una Regola («Avvia un dialogo»). La regola «Un dialogo finisce» serve a far succedere qualcosa dopo: per esempio una scelta del giocatore cambia una variabile, che più avanti apre una strada diversa.

## Lingue e traduzioni

I testi si scrivono normalmente, nella propria lingua. Nella scheda **Testi** si aggiungono le altre lingue (inglese, spagnolo, francese… o una qualsiasi con il suo codice): Pepino raccoglie da solo tutto quello che il giocatore vede, cioè Testi, Pulsanti, fumetti dei personaggi, messaggi delle Regole, battute e scelte dei dialoghi e il menù di pausa, e accanto a ogni testo c'è una casella per la traduzione. Non ci sono codici da inventare: la traduzione è legata al testo originale. Se un testo cambia, **Controlla progetto** segnala quante traduzioni mancano; quelle rimaste senza testo si tolgono con un clic.

Nel gioco la prima volta si sceglie da sola la lingua del browser, poi quella scelta dal giocatore viene ricordata. Le Regole hanno «Cambia lingua», «Passa alla lingua successiva» e la condizione «La lingua è». Nell'anteprima c'è un selettore della lingua.

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

- **Brano**: quattro canali come nelle console a 8 bit, cioè Melodia, Armonia, Basso e Batteria. Si scrive sul piano roll: clic per aggiungere una nota, trascina per allungarla, clic destro per cancellarla. Le note degli altri canali si vedono in trasparenza, e le righe della batteria stanno sempre sotto la tastiera: il ritmo si scrive guardando la melodia. Ogni canale ha la sua onda (quadra, impulso 25% e 12%, triangolo, dente di sega, sinusoide, rumore), il volume, l'attacco e il rilascio; la batteria ha cassa, rullante, charleston e piatto. Per il brano si scelgono BPM, numero di battute, loop ed eco, che dà il suono più pieno dei giochi a 16 bit.
- **Effetto**: come sfxr. I pulsanti Moneta, Salto, Colpo, Esplosione, Potenziamento, Laser, Blip e Caduta creano ogni volta un effetto nuovo di quel tipo; poi lo si ritocca con i cursori (frequenza iniziale e finale, salita, tenuta, sfumatura, vibrato, salto di nota, suono «sporco»). Ogni modifica si ascolta subito.
- **Salvare**: il suono fa già parte del progetto. **Salva** scrive il progetto sul disco, **Salva una copia** tiene la versione che ti piace e ne apre una copia da modificare (utile per generare più varianti). Il nome in alto si cambia per rinominarlo: blocchi, Regole e scene che lo usano si aggiornano da soli.

## Filmati

Un filmato è una scena animata: i personaggi si spostano, la camera li inquadra, parlano, lo schermo sfuma al nero. Nella scheda **Filmati** si scrive come un elenco di **passi** eseguiti uno dopo l'altro. I passi sono le stesse azioni delle Regole (suoni, variabili, animazioni, cambi di scena…), più quelle della categoria **Filmati**, che aspettano di aver finito prima di passare alla successiva:

- **Porta un oggetto in un punto** (dove si trova un altro oggetto) e **Sposta un oggetto di qualche tile**, in un tempo scelto;
- **Sposta la camera su un oggetto** e **La camera torna a seguire**;
- **Dialogo e aspetta la fine**, **Messaggio e aspetta**;
- **Dissolvenza al nero** e **Torna dal nero**, **Barre del cinema**;
- **Attendi**, già presente nelle Regole, per le pause.

Mentre un filmato scorre il giocatore non comanda il personaggio e, con l'opzione «Niente danni durante i filmati» della Salute (attiva di base), non può farsi male (dialoghi e messaggi rispondono ancora ai tasti), e le barre nere del cinema entrano da sole se l'opzione è attiva. Con **Esc** (o Start) il giocatore lo salta, se il filmato lo permette: gli spostamenti arrivano subito a destinazione e i passi rimasti si eseguono senza dialoghi né messaggi. Un filmato parte con la Regola **Avvia un filmato**; quando finisce scatta l'evento **Un filmato finisce**, e c'è la condizione **È in corso un filmato**. La Regola **Blocca i comandi del giocatore** blocca i comandi anche fuori dai filmati.

## Regole

Ogni regola si legge come una frase: **Quando** succede qualcosa, **e se** valgono delle condizioni, **allora** esegui delle azioni. Qualche esempio:

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

- **Beat 'em up**: il blocco «Controller Beat 'em up» cammina su un piano (avanti/indietro e profondità della strada) e salta su un terzo asse: lo sprite sale, il corpo e l'ombra («Ombra a terra» nello Sprite) restano sulla strada, e i colpi valgono solo tra chi è alla stessa profondità e altezza. Nella scena va attivato «Ordina per Y». La camera «Scorre solo in orizzontale», «Non torna indietro» la fa solo avanzare, e con l'azione «Blocca la camera» più «L'oggetto non esce dallo schermo» si fanno le arene a ondate. L'«Attacco corpo a corpo» in modalità «Da solo» colpisce quando il bersaglio è a portata: basta per i nemici. Per il giocatore c'è la «Combo di colpi»: ogni colpo è uno stato (`attack1`, `attack2`, `attack3`, `airAttack`) che l'Animatore collega all'animazione con lo stesso nome; il tasto premuto durante un colpo viene ricordato, e i colpi forti mandano a terra (il nemico vola, resta steso e si rialza). In fondo alla strada del modello c'è il Capo dei teppisti, un «Boss» con tre fasi.
- **Camera a stanze**: passa da uno schermo all'altro e manda l'evento «Entra in un'altra stanza» alle Regole.
- **Luci 2D**: nelle impostazioni della scena si attiva la luce ambiente (il colore del buio); gli oggetti con il blocco «Luce» illuminano intorno a sé. Le Regole possono cambiare la luce ambiente (giorno → notte).
- **Effetti a tutto schermo**: vignetta, vecchio televisore (CRT), Game Boy, bianco e nero, seppia, con l'intensità. Si scelgono per scena o da una Regola.
- **Controlli touch**: su telefoni e tablet il gioco esportato mostra joystick e fino a 4 pulsanti (si scelgono nella sezione Progetto). Aggiungendo `&touch` all'indirizzo del gioco si provano anche da PC; nell'anteprima c'è il pulsante «Touch».
- **Modelli di progetto**: «Nuovo» crea un progetto vuoto o uno dei tredici giochi piccoli ma completi, uno per genere.
- **Shoot'em up**: il modello «Nello spazio» è uno sparatutto a scorrimento verticale. Un oggetto con **Scorrimento automatico** fa salire lo schermo e porta con sé le stelle (Particelle); la navicella ha il **Controller Navicella** e **Spara** verso l'alto tenendo premuto Z; i laser hanno «Sparisce fuori dallo schermo», così non abbattono nemici che non si vedono ancora. Le ondate di ufo, caccia in picchiata e ufo che sparano usano **Traiettoria** e partono quando entrano nello schermo; in cima aspetta un'astronave madre che spara a ventaglio. Musica ed effetti sonori sono creati con la scheda Musica, i punti con una Regola.
- **Tower defense**: nel modello «Difesa del villaggio» gli slime arrivano a **Ondate** e con **Segue un percorso** camminano lungo i **Punti del percorso** del sentiero. Cliccando una **Piazzola** si costruisce una torretta per 20 monete; la torretta ha **Spara** in automatico verso il nemico più vicino. Le Regole danno 5 monete per ogni slime sconfitto, tolgono vita a chi arriva in fondo, fanno ricominciare quando la vita finisce e portano alla fine quando le ondate sono respinte.
- **Corse 2D**: nel modello «Gran premio dei cetrioli» l'auto ha il **Controller Auto** (↑ gas, ↓ freno, ← → sterzo) e rallenta sull'erba, cioè dove il layer «Pista» non ha tile: manda gli eventi «Esce di pista» e «Torna in pista» e, con «Rimetti in pista dopo», se resta fuori troppo a lungo torna dov'era in pista poco prima. La sprite ruota con l'auto anche insieme agli Effetti animati. La linea d'arrivo e tre punti della pista sono **Traguardi**; il blocco **Giri** li conta in ordine e scrive giro, tempo, giro migliore e posizione nelle variabili dell'HUD. I tre avversari usano **Segue un percorso** con «Ruota verso dove va» e «Parte da solo» spento: una Regola blocca i comandi, fa il conto alla rovescia e poi dà il via a tutti con «Azione di un blocco → Riparti».
- **Punta e clicca**: nel modello «La casa del nonno» Pepino ha **Cammina dove clicchi** e va dove clicchi (o tocchi). Finestra, quadro, cassettiera, vaso, porta e nonno sono **Punti cliccabili**: il nome compare sotto il puntatore e, quando Pepino arriva, si vede la descrizione o partono le Regole. La moneta sul pavimento si raccoglie e finisce nell'**Inventario**; cliccandola nella barra la si sceglie e poi la si usa sul nonno («Oggetto che serve»), che si ricorda dove ha nascosto la chiave. Le Regole «Metti nell'inventario», «Togli dall'inventario» e «Nell'inventario c'è un oggetto» lavorano sulla variabile `inventario`, che resta cambiando scena e si salva con la partita. In tutti i giochi un clic (o un tocco) fa andare avanti messaggi e dialoghi e sceglie la risposta sotto il puntatore.
- **Prima persona**: nel modello «Il labirinto degli slime» si gioca dagli occhi di Pepino. La scena si disegna vista dall'alto, come un livello top-down: i tile solidi del layer «Muri» diventano pareti di pietra. Pepino ha il **Controller prima persona**, la **Vista in prima persona** (muri, figure, mappa e mirino) e le **Armi in prima persona**: l'elenco ha una riga per arma (immagine, danno, munizioni, suoni) e con E si passa dall'una all'altra, con quella in mano che si abbassa e la nuova che si alza. Il Lanciapeperoncini sta nell'elenco con «Disponibile se la variabile `arma2`»: finché non lo trovi non è in mano. Gli slime usano i blocchi di sempre (Insegue, Attacco corpo a corpo) e nella vista diventano figure; munizioni, medikit e stella sono **Oggetti da raccogliere**. L'uscita è una porta con **Uscita verso scena**.
- **Picchiaduro 1 contro 1**: nel modello «Sfida sul tetto» i due lottatori hanno il **Controller Picchiaduro** (si guardano sempre, avanzano più veloci di quanto indietreggiano, saltano, si abbassano e parano tenendo indietro) e la **Combo di colpi**. Il rivale aggiunge l'**Avversario 1 contro 1**, che decide da solo se attaccare, difendersi o saltare. La **Regia dell'incontro**, su un oggetto vuoto, conta i round al meglio dei tre, il tempo e le vittorie, disegna le barre della vita e annuncia «Round 1», «K.O.» e il vincitore; chi va al tappeto resta a terra (stato «A terra») e il computer smette di attaccare finché il round dopo non ricomincia; alla fine manda l'evento «Finisce l'incontro» alle Regole.
- **Roguelike**: nel modello «Le cantine del nonno» il layer parte tutto pieno di roccia e il blocco **Sotterraneo a caso** ci scava stanze e corridoi all'avvio, porta Pepino nella prima stanza, mette la **Scala per il piano dopo** in quella più lontana e sparpaglia slime, scrigni e pozioni (una riga per modello, con quanti al primo piano e quanti in più a ogni piano). La scala aumenta la variabile `piano` e ricarica la scena: mappa nuova, più nemici. La **Minimappa** mostra dove sei.
- **Gioco di carte**: nel modello «Il torneo dell'orto» il **Duello a carte** tiene mazzo, mano, energia e punti vita dei due contendenti. Le carte si scrivono una per riga (nome, costo, cosa fa, quanto, copie, colore) e le mosse dell'avversario allo stesso modo. Si gioca con ← → e C, si chiude il turno con X o cliccando «Fine turno», e si può cliccare direttamente una carta. Vincendo il primo duello la Regola «Impara una carta» aggiunge il Peperoncino alla variabile `carte`, che lo porta nel mazzo del duello successivo.
- **Horror**: nel modello «La serra abbandonata» la scena ha la luce ambiente quasi nera e Pepino ha la **Torcia** (fascio davanti a sé, batteria che si consuma, Q per accenderla) e il **Coraggio**, che cala al buio e vicino al mostro e fa pulsare lo schermo quando è poco. L'Ombra usa **Ti cerca al buio**: vaga per la serra, sente i passi veloci, vede in un cono e dà la caccia; negli armadi (**Nascondiglio**, Azione per entrare e uscire) non ti trova e non può colpirti, il coraggio risale e la torcia non consuma. Servono tre fusibili per aprire il cancello.
- **Gioco a ritmo**: nel modello «Il concerto dell'orto» il blocco **Note a tempo** fa scendere le note su quattro corsie a 120 battiti al minuto, come la musica. Il disegno delle note è una fila di numeri (`1-2-3-4-`), oppure le inventa il computer con densità e seme. Premendo ← ↓ ↑ → al momento giusto arrivano «Perfetto» o «Bene», la combo sale e il punteggio finisce in una variabile; alla fine parte l'evento «La canzone è finita».

## Oggetti, inventario, potenziamenti e negozio

Nella scheda **Oggetti** si crea l'archivio degli oggetti del gioco. Ognuno ha nome, icona (anche un fotogramma di uno sprite sheet), descrizione, prezzo, quanti se ne possono tenere e un **tipo**:

- **Si usa e sparisce** (pozioni, cibo): va nell'inventario e si consuma quando si usa;
- **Resta nell'inventario** (chiavi, oggetti delle missioni): serve ai Punti cliccabili e alle Regole;
- **Fa effetto appena preso** (monete, munizioni, potenziamenti): non entra nell'inventario.

**Quando si usa** un oggetto può curare, aggiungere a una variabile (munizioni, punti…) o dare un **potenziamento a tempo**. I potenziamenti arrivano solo a chi ha il blocco **Potenziamenti**: velocità (×1,6), super salto (×1,5), invincibilità (colore che cambia), più forza (danno ×2 per attacchi, combo, proiettili e schiacciate), calamita (monete e oggetti vicini volano verso il giocatore), scudo (para un colpo), salto in più. In alto a destra si vede quanto tempo resta.

I blocchi pronti sono **Oggetto da raccogliere** (l'oggetto nella scena, con la sua icona), **Inventario** (la barra: Q usa l'oggetto scelto, E cambia casella, un clic lo usa; nelle avventure si sceglie e si usa su un punto), **Potenziamenti** e **Negozio**: vicino al venditore si preme Azione (o lo si clicca) e si apre la finestra con gli oggetti in vendita; si sceglie con le frecce o il mouse, si paga con una variabile (le monete) e il gioco resta fermo finché è aperta.

Nelle Regole (categoria Inventario): «Metti nell'inventario», «Togli dall'inventario», «Nell'inventario c'è un oggetto» (con la quantità), «Usa un oggetto dell'inventario», l'evento «Un oggetto viene usato», «Dai un potenziamento» e «Ha un potenziamento». L'inventario sta nella variabile `inventario` (per esempio `pozione:2|chiave`): resta cambiando scena e si salva con la partita. Nei modelli: la bottega di Zia Zucca nel villaggio top-down, la stella e la calamita nel platform, munizioni e medikit nel labirinto in prima persona.

## Blocchi in codice

Quando i blocchi pronti non bastano, nella scheda **Codice** si scrive un blocco nuovo in **Pepino Language** (vedi la sezione seguente), in **JavaScript** o in **Python**. Il blocco compare nell'Inspector («Aggiungi blocco» → Personalizzati) e le sue azioni, condizioni ed eventi compaiono nelle Regole, esattamente come quelli di Pepino. Il codice viene salvato dentro `project.json` e finisce anche nella build WebGL.

- Le modifiche si applicano da sole mentre scrivi; gli errori di scrittura vengono sottolineati, con la riga.
- Se uno script ha un errore, gli oggetti continuano a usare l'ultima versione che funzionava.
- Se un blocco va in errore a gioco avviato, si ferma solo quel blocco e la Console indica script e riga (clic per aprirlo).

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

## Pepino Language

Il linguaggio di Pepino, pensato per chi impara (anche i più piccoli) ma preciso come un linguaggio «vero». Guida completa: [docs/pepino.html](docs/pepino.html).

- **Bilingue**: le stesse parole in italiano e in inglese (`se`/`if`, `ripeti 3 volte`/`repeat 3 times`, `scrivi`/`print`); nell'editor il pulsante «In inglese» / «In italiano» riscrive lo script nell'altra lingua lasciando intatti i nomi scelti da chi programma. I messaggi d'errore arrivano nella lingua del programma (nell'editor, in quella dell'editor).
- **Memoria come il C++, ma sicura**: `b = a` fa una copia vera; `sposta` passa un valore senza copiarlo (e il compilatore vieta di usare il vecchio nome); i parametri sono prestiti in sola lettura, `cambia` li rende modificabili (e si scrive anche nella chiamata); `quando finisce` in un tipo è un distruttore che parte subito, in ordine inverso, anche con uscite anticipate ed errori. Niente puntatori nulli (`niente` solo nei tipi con `?`, da controllare) e niente riferimenti che restano appesi. Nel JavaScript generato la memoria la libera il browser, ma le regole sono rispettate alla lettera.
- **Tipi dedotti**: non serve scriverli, ma il compilatore li conosce; una funzione senza tipi è un modello (una versione per ogni tipo usato, come i template del C++).
- **Unità di misura**: `4 tile/s`, `0.5 s`, `200 ms`, `90°`; i conti si convertono da soli e sommare un tempo a una distanza è un errore.
- **Aspettare**: `aspetta 1 s`, `aspetta finché …` dentro le funzioni, senza callback.
- **Le parole italiane di tutti**, uguali in un programma italiano e in uno inglese (anche mescolate):
  - `mamma mia! "…"`: un errore grave che nessun `tenta` ferma;
  - `pizza Tipo:`: crea un valore un ingrediente per riga (campi di un tipo, elementi di una `Lista`, coppie di una `Mappa`);
  - `spaghetti valore:`: una catena di passi, ognuno sul risultato del precedente, senza cambiare l'originale;
  - `bravo:`: dopo `tenta … se errore`, parte solo se è andato tutto bene e vede le variabili del tentativo;
  - `cappuccino 2 s:`: il blocco parte più tardi (o in parallelo) e intanto il codice va avanti. Nell'engine appartiene all'oggetto: se l'oggetto sparisce, non arriva.

  Esempio: `npm run pepino -- esegui samples/pepino/pizzeria.pep`.
- **Errori gentili**: «Non conosco «punto»: forse volevi dire «punti»?», posizioni delle liste da 1, `=` nelle condizioni vuol dire «uguale», prove integrate (`prova "nome":` + `controlla`).

```
blocco Passeggia "Passeggia":
    proprietà distanza = 3 tile, "Distanza", da 0 a 20
    proprietà velocità = 2 tile/s, "Velocità"
    evento giro "Ha finito un giro"
    partenza = 0

    quando inizia:
        partenza = oggetto.x
        ripeti:
            cammina_fino_a(partenza + distanza)
            aspetta 0.5 s
            cammina_fino_a(partenza)
            emetti giro

    funzione cammina_fino_a(meta: Numero):
        mentre oggetto.x != meta:
            oggetto.x = avvicina(oggetto.x, meta, velocità * dt)
            aspetta
```

Nell'editor: pulsante **+ Pepino** nella scheda Codice, colori, suggerimenti mentre scrivi, errori sottolineati con messaggi chiari, guida a lato, «JavaScript generato», pulsante **Prove** (esegue le `prova` dello script e scrive i risultati nella Console). Nomi pronti nei blocchi: `oggetto`, `corpo`, `scena`, `gioco`, `dt`.

**Fuori dall'engine** lo stesso linguaggio serve per qualsiasi programma, con il comando `pepino`:

```bash
npm run pepino -- esegui samples/pepino/indovina.pep
```

`esegui` (`run`), `controlla` (`check`), `prova` (`test`), `traduci file.pep en` (`translate`), `js` (JavaScript generato), `nuovo ciao.pep` (`new`). Ci sono `chiedi`/`chiedi_numero` (tastiera), `leggi_file`/`scrivi_file`, `argomenti()` e `usa "altro.pep"` per i programmi su più file. Esempi in `samples/pepino/`.

## Struttura

```
src/runtime/   motore di gioco (TypeScript + WebGL2): loop, renderer, input, audio, collisioni, blocchi
src/lang/      Pepino Language: lexer, parser, controllo dei tipi e della memoria, generatore di JavaScript, comando pepino
src/player/    pagina del gioco esportato (diventa pepino.js)
src/main/      processo principale Electron (file, protocollo pepino://, export)
src/preload/   ponte sicuro tra Electron e l'editor
src/renderer/  editor (React)
scripts/       generatori: modelli di progetto (gen-sample.mjs), esportazione degli esempi, comando pepino
samples/templates/ modelli di «Nuovo progetto» (un file per genere) e i loro asset (assets/)
samples/pepino/ programmi di esempio in Pepino Language
docs/          analisi iniziale e guida di Pepino Language
```

## Stato e prossimi passi

Fatto: runtime (fase 0), editor di base (fase 1), primi blocchi con anteprima ed export (fase 2), Regole, menù, messaggi, pausa e salvataggi (fase 3), nemici che inseguono e sparano, attacchi, generatori, dialoghi con scelte e ritratti (fase 4), blocchi in codice JavaScript e Python con editor integrato (fase 5), beat 'em up con asse dell'altezza, camera a stanze, luci 2D, particelle, effetti a tutto schermo, controlli touch, traduzioni in più lingue e modelli di progetto per genere (fase 6), combo animate, reazioni ai colpi, boss a stati ed effetti animati delle sprite (fase 7), editor in inglese e finestra Impostazioni (fase 8), caratteri Pixel, di sistema e importati per i testi del gioco (fase 9), editor di pixel art con livelli, fotogrammi e tavolozze (fase 10), brani chiptune ed effetti sonori creati nell'editor (fase 11), filmati con spostamenti, camera, dialoghi e dissolvenze (fase 12), Pepino Language con editor integrato e comando `pepino` (fase 15), le parole italiane di Pepino Language (fase 17), multigiocatore locale con i blocchi per i giochi di gruppo e i bot (fase 18), pannelli dell'editor ridimensionabili.

Prossimi passi:

1. Autotile per dipingere i livelli più in fretta.
2. Anteprima di luci ed effetti direttamente nella vista scena dell'editor.
3. Script in TypeScript e completamento automatico dell'API nell'editor del codice.

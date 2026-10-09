import type { Lang } from "./words";

/** Un argomento di un messaggio: testo fisso, oppure qualcosa che si scrive in modo diverso per lingua (un tipo). */
export type MsgArg = string | number | ((lang: Lang) => string);

export interface Span {
  line: number;
  col: number;
  pos: number;
  end: number;
}

export interface Diagnostic extends Span {
  severity: "error" | "warning";
  key: string;
  args: MsgArg[];
  /** Il messaggio già scritto nella lingua scelta (lo riempie `renderDiagnostics`). */
  message: string;
  /** Il file (quando il programma usa altri file con «usa»). */
  file?: string;
}

export function makeDiag(severity: Diagnostic["severity"], key: string, args: MsgArg[], span: Span): Diagnostic {
  return { severity, key, args, line: span.line, col: span.col, pos: span.pos, end: Math.max(span.end, span.pos), message: "" };
}

/** Messaggi: chiave → [italiano, inglese]. {0}, {1}… sono gli argomenti. */
const MESSAGES: Record<string, [string, string]> = {
  // ------------------------------------------------------------ scrittura (lexer)
  "lex.badIndent": ["Il rientro di questa riga non corrisponde a nessun blocco sopra: allinea la riga con quelle prima.", "This line's indentation doesn't match any block above: line it up with the lines before."],
  "lex.badEscape": ["«\\{0}» non è un carattere speciale valido: usa \\n (a capo), \\t, \\\\, \\\" o \\{.", "\"\\{0}\" is not a valid escape: use \\n (new line), \\t, \\\\, \\\" or \\{."],
  "lex.openHole": ["Manca la graffa } che chiude il codice dentro la stringa.", "The } closing the code inside the string is missing."],
  "lex.emptyHole": ["Le graffe {} dentro una stringa devono contenere qualcosa: per scrivere una graffa usa {{.", "Braces {} inside a string must contain something: to write a brace use {{."],
  "lex.openString": ["La stringa non è chiusa: manca la virgoletta alla fine.", "The string is not closed: the closing quote is missing."],
  "lex.badChar": ["Il carattere «{0}» qui non vuol dire niente.", "The character \"{0}\" means nothing here."],
  // ------------------------------------------------------------ grammatica (parser)
  "parse.expected": ["Qui mi aspettavo {0}, invece c'è {1}.", "I expected {0} here, but found {1}."],
  "parse.expectedExpr": ["Qui manca un valore (un numero, un nome, una stringa…), invece c'è {0}.", "A value is missing here (a number, a name, a string…), found {0} instead."],
  "parse.expectedName": ["Qui ci vuole un nome, invece c'è {0}.", "A name is needed here, found {0} instead."],
  "parse.expectedColon": ["Manca i due punti «:» alla fine della riga.", "The colon \":\" is missing at the end of the line."],
  "parse.expectedBlock": ["Dopo i due punti le righe del blocco vanno scritte più a destra (rientrate).", "After the colon, the block's lines must be indented."],
  "parse.unexpectedIndent": ["Questa riga è più a destra delle altre senza motivo: toglile il rientro.", "This line is indented for no reason: remove the indentation."],
  "parse.extra": ["Dopo {0} la riga dovrebbe finire, invece c'è {1}.", "After {0} the line should end, but there's {1}."],
  "parse.badTarget": ["A sinistra di «=» ci vuole un nome (o un campo, o una posizione di una lista).", "The left side of \"=\" must be a name (or a field, or a list position)."],
  "parse.elseAlone": ["«altrimenti» deve venire subito dopo un «se».", "\"else\" must come right after an \"if\"."],
  "parse.caseAlone": ["«caso» si usa solo dentro «scegli».", "\"case\" can only be used inside \"match\"."],
  "parse.returnOutside": ["«ritorna» si usa solo dentro una funzione.", "\"return\" can only be used inside a function."],
  "parse.breakOutside": ["«{0}» si usa solo dentro un ciclo (ripeti, mentre, per ogni).", "\"{0}\" can only be used inside a loop (repeat, while, for each)."],
  "parse.nested": ["{0} si può scrivere solo all'inizio del file, non dentro altro codice.", "{0} can only be written at the top level of the file, not inside other code."],
  "parse.badUnit": ["«{0}» non è un'unità di misura: usa s, ms, min, px, tile, ° o rad.", "\"{0}\" is not a unit: use s, ms, min, px, tile, ° or rad."],
  "parse.lambdaParams": ["I parametri di una funzione veloce (x => …) devono essere nomi.", "The parameters of a quick function (x => …) must be names."],
  "parse.namedAfter": ["Dopo un argomento con il nome (nome: valore) anche gli altri devono avere il nome.", "After a named argument (name: value) the others must be named too."],
  "parse.blockItem": ["Dentro un blocco si scrivono proprietà, eventi, campi, funzioni, azioni, condizioni e «quando …».", "Inside a block you write properties, events, fields, functions, actions, conditions and \"on …\"."],
  "parse.typeItem": ["Dentro un tipo si scrivono campi (nome: Tipo o nome = valore), funzioni e «quando crea/finisce».", "Inside a type you write fields (name: Type or name = value), functions and \"on create/end\"."],
  "parse.badHook": ["«quando {0}» non esiste qui. Puoi usare: {1}.", "\"on {0}\" doesn't exist here. You can use: {1}."],
  "parse.duplicateHook": ["«quando {0}» è già scritto sopra in questo blocco.", "\"on {0}\" is already written above in this block."],
  "parse.number": ["Qui ci vuole un numero scritto con le cifre.", "A number written with digits is needed here."],
  "parse.string": ["Qui ci vuole un testo tra virgolette.", "A text between quotes is needed here."],
  "parse.changeArg": ["Dopo «cambia» ci vuole il nome di quello che la funzione può cambiare.", "After \"change\" you need the name of what the function may change."],
  "parse.bang": ["Il punto esclamativo si usa solo in «mamma mia!». Per dire «non» scrivi «non» (e «!=» per «diverso»).", "The exclamation mark is only used in \"mamma mia!\". To say \"not\" write \"not\" (and \"!=\" for \"different\")."],
  "parse.blockValuePlace": ["«{0}» continua nelle righe sotto, quindi va da sola alla fine della riga: dopo «=», dopo «ritorna» o all'inizio della riga.", "\"{0}\" goes on in the lines below, so it must stand alone at the end of the line: after \"=\", after \"return\" or at the start of the line."],
  "parse.pizzaType": ["Dopo «pizza» ci vuole il nome di un tipo (Lista, Mappa o un tipo tuo), poi i due punti e un ingrediente per riga.", "After \"pizza\" you need the name of a type (List, Map or one of yours), then the colon and one ingredient per line."],
  "parse.pipeStep": ["Ogni riga di «spaghetti» è un passo: il nome di una funzione o di un metodo, con le parentesi se servono. Qui c'è {0}.", "Each line of \"spaghetti\" is a step: the name of a function or a method, with parentheses if needed. Here there's {0}."],
  // ------------------------------------------------------------ nomi
  "name.unknown": ["Non conosco «{0}».", "I don't know \"{0}\"."],
  "name.unknownDid": ["Non conosco «{0}»: forse volevi dire «{1}»?", "I don't know \"{0}\": did you mean \"{1}\"?"],
  "name.notYet": ["«{0}» non esiste ancora a questo punto: viene creato alla riga {1}.", "\"{0}\" doesn't exist yet at this point: it's created on line {1}."],
  "name.onlyIn": ["«{0}» esiste solo dentro il blocco della riga {1}: crealo prima, fuori dal blocco.", "\"{0}\" only exists inside the block on line {1}: create it before, outside the block."],
  "name.duplicate": ["Il nome «{0}» è già usato alla riga {1}.", "The name \"{0}\" is already used on line {1}."],
  "name.reservedType": ["«{0}» è il nome di un tipo: scegline un altro.", "\"{0}\" is the name of a type: choose another."],
  "name.isType": ["«{0}» è un tipo, non un valore: per crearne uno scrivi {0}(…).", "\"{0}\" is a type, not a value: to create one write {0}(…)."],
  "name.isFunction": ["«{0}» è una funzione: per usarla scrivi {0}(…).", "\"{0}\" is a function: to use it write {0}(…)."],
  "name.constant": ["«{0}» è una costante: non si può cambiare.", "\"{0}\" is a constant: it can't be changed."],
  "name.borrowed": ["«{0}» è solo prestato alla funzione, che può leggerlo ma non cambiarlo. Scrivi «cambia {0}» nei parametri, oppure lavora su una copia: copia = {0}.", "\"{0}\" is only lent to the function, which can read it but not change it. Write \"change {0}\" in the parameters, or work on a copy: copy = {0}."],
  "name.loopVar": ["«{0}» è l'elemento del ciclo, che qui si può solo leggere: per cambiarlo scrivi «per ogni cambia {0} in …».", "\"{0}\" is the loop element, which can only be read here: to change it write \"for each change {0} in …\"."],
  "name.frozen": ["Non puoi cambiare «{0}» mentre lo stai scorrendo con «per ogni» (riga {1}). Usa .togli_se(…) o una nuova lista.", "You can't change \"{0}\" while you're looping over it with \"for each\" (line {1}). Use .remove_if(…) or a new list."],
  "name.captured": ["«{0}» dentro una funzione veloce è una copia: si può leggere ma non cambiare.", "\"{0}\" inside a quick function is a copy: it can be read but not changed."],
  "name.capturedLater": ["«{0}» dentro il cappuccino è una copia presa quando l'hai ordinato: si può leggere ma non cambiare. Per cambiare qualcosa più tardi usa un campo del blocco o una variabile di tutto il programma.", "\"{0}\" inside the cappuccino is a copy taken when you ordered it: it can be read but not changed. To change something later use a block field or a program-wide variable."],
  "name.shadowHost": ["«{0}» è già il nome di {1}: scegline un altro.", "\"{0}\" is already the name of {1}: choose another."],
  // ------------------------------------------------------------ memoria
  "mem.moved": ["«{0}» è stato spostato alla riga {1} (con «sposta»): non c'è più. Dagli un nuovo valore prima di usarlo.", "\"{0}\" was moved on line {1} (with \"move\"): it's gone. Give it a new value before using it."],
  "mem.maybeMoved": ["«{0}» potrebbe essere stato spostato alla riga {1}: in alcuni casi non c'è più.", "\"{0}\" may have been moved on line {1}: in some cases it's gone."],
  "mem.moveInLoop": ["«{0}» viene spostato dentro il ciclo, ma al giro dopo non ci sarebbe più. Dagli un nuovo valore prima della fine del ciclo, o usa una copia.", "\"{0}\" is moved inside the loop, but it would be gone on the next round. Give it a new value before the end of the loop, or use a copy."],
  "mem.moveWhat": ["«sposta» funziona solo con il nome di una variabile (non con un campo o una posizione di una lista).", "\"move\" only works with the name of a variable (not with a field or a list position)."],
  "mem.moveBorrowed": ["«{0}» è solo prestato: non puoi spostarlo via. Scrivi «prendi {0}» nei parametri se la funzione deve tenerlo.", "\"{0}\" is only lent: you can't move it away. Write \"take {0}\" in the parameters if the function must keep it."],
  "mem.moveGlobal": ["Non puoi spostare «{0}» da dentro una funzione: è una variabile di tutto il programma.", "You can't move \"{0}\" from inside a function: it's a program-wide variable."],
  "mem.exclusive": ["«{0}» qui è usato due volte, e una delle due lo cambia: passalo una volta sola, o usa una copia.", "\"{0}\" is used twice here, and one of them changes it: pass it only once, or use a copy."],
  "mem.changeArg": ["Il parametro «{0}» può essere cambiato dalla funzione: scrivi «cambia» prima del valore, così si vede. Esempio: {1}(cambia x).", "The parameter \"{0}\" may be changed by the function: write \"change\" before the value, so it shows. Example: {1}(change x)."],
  "mem.changeNotParam": ["Il parametro «{0}» non può essere cambiato dalla funzione: togli «cambia».", "The parameter \"{0}\" can't be changed by the function: remove \"change\"."],
  "mem.changePlace": ["Con «cambia» ci vuole qualcosa che si può cambiare: una variabile, un campo o una posizione di una lista.", "With \"change\" you need something that can be changed: a variable, a field or a list position."],
  "mem.changeInRoutine": ["Una funzione che aspetta non può avere parametri «cambia».", "A function that waits can't have \"change\" parameters."],
  "mem.fnValueChange": ["Una funzione con parametri «cambia» o «prendi» non si può usare come valore.", "A function with \"change\" or \"take\" parameters can't be used as a value."],
  "mem.thisAssign": ["Non puoi sostituire «questo»: cambia i suoi campi uno per volta.", "You can't replace \"this\": change its fields one at a time."],
  // ------------------------------------------------------------ tipi
  "type.mismatch": ["Qui ci vuole {0}, ma questo è {1}.", "{0} is needed here, but this is {1}."],
  "type.assign": ["«{0}» è {1}: non puoi dargli {2}.", "\"{0}\" is {1}: you can't give it {2}."],
  "type.unknown": ["Non conosco il tipo «{0}».", "I don't know the type \"{0}\"."],
  "type.unknownDid": ["Non conosco il tipo «{0}»: forse volevi dire «{1}»?", "I don't know the type \"{0}\": did you mean \"{1}\"?"],
  "type.binary": ["Non si può fare {0} {1} {2}.", "You can't do {0} {1} {2}."],
  "type.unary": ["Non si può fare {0} su {1}.", "You can't use {0} on {1}."],
  "type.condition": ["La condizione deve essere vera o falsa (un SiNo), ma questo è {0}.", "The condition must be true or false (a YesNo), but this is {0}."],
  "type.maybeNothing": ["«{0}» potrebbe essere niente: controlla prima con «se {0} != niente:».", "\"{0}\" might be nothing: check first with \"if {0} != nothing:\"."],
  "type.maybeNothingExpr": ["Questo valore potrebbe essere niente: mettilo in una variabile e controlla con «se … != niente:».", "This value might be nothing: put it in a variable and check with \"if … != nothing:\"."],
  "type.notNothing": ["{0} non può essere niente. Per permetterlo scrivi il tipo con il punto di domanda: {1}?", "{0} can't be nothing. To allow it, write the type with a question mark: {1}?"],
  "type.cantInfer": ["Non so che cosa conterrà «{0}»: scrivi il tipo, per esempio {0}: Lista di Numero = [].", "I don't know what \"{0}\" will contain: write the type, for example {0}: List of Number = []."],
  "type.cantInferExpr": ["Non so di che tipo è questo valore: mettilo in una variabile con il tipo scritto.", "I don't know the type of this value: put it in a variable with a written type."],
  "type.noMember": ["{0} non ha «{1}».", "{0} has no \"{1}\"."],
  "type.noMemberDid": ["{0} non ha «{1}»: forse volevi dire «{2}»?", "{0} has no \"{1}\": did you mean \"{2}\"?"],
  "type.notCallable": ["{0} non è una funzione: non si può chiamare con ( ).", "{0} is not a function: it can't be called with ( )."],
  "type.notIndexable": ["{0} non ha posizioni: [ ] si usa con liste, testi e mappe.", "{0} has no positions: [ ] is used with lists, texts and maps."],
  "type.notIterable": ["{0} non si può scorrere con «per ogni»: si scorrono liste, testi e mappe.", "{0} can't be looped over with \"for each\": you can loop over lists, texts and maps."],
  "type.readOnly": ["«{0}» si può solo leggere.", "\"{0}\" can only be read."],
  "type.argCount": ["{0} vuole {1} valori, ma qui ne hai dati {2}.", "{0} wants {1} values, but you gave {2} here."],
  "type.argCountRange": ["{0} vuole da {1} a {2} valori, ma qui ne hai dati {3}.", "{0} wants {1} to {2} values, but you gave {3} here."],
  "type.missingArg": ["Manca «{0}» per {1}.", "\"{0}\" is missing for {1}."],
  "type.noParam": ["{0} non ha un parametro «{1}».", "{0} has no parameter \"{1}\"."],
  "type.noParamDid": ["{0} non ha un parametro «{1}»: forse volevi dire «{2}»?", "{0} has no parameter \"{1}\": did you mean \"{2}\"?"],
  "type.twiceArg": ["«{0}» è dato due volte.", "\"{0}\" is given twice."],
  "type.returnValue": ["Questa funzione deve restituire {0}: scrivi «ritorna» con un valore.", "This function must return {0}: write \"return\" with a value."],
  "type.returnNothing": ["Questa funzione non restituisce niente: togli il valore dopo «ritorna».", "This function returns nothing: remove the value after \"return\"."],
  "type.missingReturn": ["La funzione «{0}» deve restituire {1}, ma in qualche caso arriva alla fine senza «ritorna».", "The function \"{0}\" must return {1}, but in some case it reaches the end without \"return\"."],
  "type.void": ["{0} non restituisce niente: non puoi usarlo come valore.", "{0} returns nothing: you can't use it as a value."],
  "type.recursive": ["«{0}» chiama sé stessa: scrivi il tipo che restituisce, per esempio funzione {0}(…) -> Numero:", "\"{0}\" calls itself: write the type it returns, for example function {0}(…) -> Number:"],
  "type.lambdaNoContext": ["Qui non so che valori riceverà la funzione veloce: usala dove serve una funzione (per esempio in .filtra).", "Here I don't know what values the quick function will get: use it where a function is expected (for example in .filter)."],
  "type.genericValue": ["«{0}» non ha i tipi dei parametri: per usarla come valore scrivili (a: Numero).", "\"{0}\" has no parameter types: to use it as a value write them (a: Number)."],
  "type.emptyList": ["Una lista vuota [] qui non basta: non so che cosa conterrà.", "An empty list [] isn't enough here: I don't know what it will contain."],
  "type.mixedList": ["Gli elementi di una lista devono essere tutti dello stesso tipo: qui c'è {0} insieme a {1}.", "A list's elements must all be of the same type: here there's {0} together with {1}."],
  "type.mapKey": ["Le chiavi di una mappa devono essere numeri, testi o scelte.", "The keys of a map must be numbers, texts or choices."],
  "type.compare": ["Si possono confrontare con < e > solo numeri o testi, non {0}.", "Only numbers or texts can be compared with < and >, not {0}."],
  "type.equal": ["Non ha senso confrontare {0} con {1}: non saranno mai uguali.", "It makes no sense to compare {0} with {1}: they'll never be equal."],
  "type.enumMember": ["La scelta «{0}» non ha «{1}». Ha: {2}.", "The choice \"{0}\" has no \"{1}\". It has: {2}."],
  "type.fieldRequired": ["Per creare {0} serve «{1}» (non ha un valore già pronto).", "To create {0}, \"{1}\" is needed (it has no ready value)."],
  "type.fieldDefault": ["Il campo «{0}» ha bisogno di un tipo o di un valore: {0}: Numero, oppure {0} = 0.", "The field \"{0}\" needs a type or a value: {0}: Number, or {0} = 0."],
  "type.thisOutside": ["«questo» si usa solo dentro le funzioni di un tipo.", "\"this\" can only be used inside a type's functions."],
  "type.caseValue": ["Nei «caso» ci vogliono valori fissi (numeri, testi, scelte).", "\"case\" needs fixed values (numbers, texts, choices)."],
  "type.caseDuplicate": ["Il caso {0} è già scritto sopra.", "The case {0} is already written above."],
  "type.anyCall": ["Non so che cosa sia questo valore (Qualsiasi): non posso controllare la chiamata.", "I don't know what this value is (Any): I can't check the call."],
  "type.sortable": ["Si possono mettere in ordine solo liste di numeri o di testi: per altre liste usa .ordina_per(…).", "Only lists of numbers or texts can be sorted: for other lists use .sort_by(…)."],
  "type.numberList": ["Serve una lista di numeri.", "A list of numbers is needed."],
  "type.divConst": ["Stai dividendo per zero.", "You're dividing by zero."],
  "type.hostType": ["{0} si può usare solo dentro Pepino Engine.", "{0} can only be used inside Pepino Engine."],
  "type.assignVoid": ["{0} non restituisce niente: non c'è niente da mettere in «{1}».", "{0} returns nothing: there's nothing to put in \"{1}\"."],
  // ------------------------------------------------------------ unità
  "unit.mismatch": ["Non puoi {0} {1} e {2}: sono grandezze diverse.", "You can't {0} {1} and {2}: they're different quantities."],
  "unit.assign": ["«{0}» è {1}, ma qui gli dai {2}.", "\"{0}\" is {1}, but here you give it {2}."],
  // ------------------------------------------------------------ flusso
  "flow.unreachable": ["Questa riga non verrà mai eseguita: sopra c'è «{0}».", "This line will never run: there's \"{0}\" above."],
  "flow.waitHere": ["Qui non si può aspettare: {0}.", "You can't wait here: {0}."],
  "flow.infinite": ["Questo ciclo non finisce mai e non aspetta: il programma si bloccherebbe. Aggiungi «aspetta» o «interrompi».", "This loop never ends and never waits: the program would freeze. Add \"wait\" or \"break\"."],
  "flow.useOutsideCli": ["«usa» funziona solo con il comando pepino, non dentro l'engine.", "\"use\" only works with the pepino command, not inside the engine."],
  "flow.useMissing": ["Non trovo il file «{0}».", "I can't find the file \"{0}\"."],
  "flow.callParens": ["Per far partire la funzione «{0}» scrivi le parentesi: {0}()", "To run the function \"{0}\" write the parentheses: {0}()"],
  "flow.unused": ["Questa riga calcola un valore ma non lo usa. Per cambiare una variabile scrivi per esempio punti += 1.", "This line computes a value but doesn't use it. To change a variable write for example points += 1."],
  "flow.recursiveRecord": ["Il tipo «{0}» contiene sé stesso nei valori già pronti dei campi: non finirebbe mai di crearsi.", "The type \"{0}\" contains itself in its fields' ready values: it would never finish being created."],
  "type.textImmutable": ["Le lettere di un testo non si cambiano una alla volta: crea un testo nuovo (per esempio con .sostituisci).", "A text's letters can't be changed one at a time: make a new text (for example with .replace)."],
  "type.propCall": ["«{0}» si scrive senza parentesi.", "\"{0}\" is written without parentheses."],
  "type.duplicateField": ["Il campo «{0}» è già scritto sopra.", "The field \"{0}\" is already written above."],
  "type.namedBuiltin": ["{0} vuole i valori in ordine, senza nomi.", "{0} wants the values in order, without names."],
  "flow.testOutside": ["«prova» si scrive solo all'inizio del file.", "\"test\" can only be written at the top level of the file."],
  // ------------------------------------------------------------ le parole italiane di tutti
  "pizza.what": ["Con «pizza» si crea una Lista, una Mappa o un tuo tipo: {0} non si prepara così.", "With \"pizza\" you make a List, a Map or one of your types: {0} can't be made this way."],
  "pipe.unknownStep": ["Non conosco il passo «{0}»: non è un metodo di {1} né una funzione.", "I don't know the step \"{0}\": it's not a method of {1} nor a function."],
  "pipe.unknownStepDid": ["Non conosco il passo «{0}»: forse volevi dire «{1}»?", "I don't know the step \"{0}\": did you mean \"{1}\"?"],
  "pipe.maybeNothing": ["Il passo prima di «{0}» può dare niente: gli spaghetti non vanno avanti con niente. Metti il valore in una variabile e controllalo con «se … != niente:».", "The step before \"{0}\" may give nothing: spaghetti can't go on with nothing. Put the value in a variable and check it with \"if … != nothing:\"."],
  "pipe.void": ["Il passo «{0}» non restituisce niente e non cambia il valore: non c'è niente da passare al passo dopo.", "The step \"{0}\" returns nothing and doesn't change the value: there's nothing to pass to the next step."],
  "later.here": ["Qui non si può ordinare un cappuccino: {0}.", "You can't order a cappuccino here: {0}."],
  "later.delay": ["Il cappuccino aspetta un tempo (per esempio 2 s), ma questo è {0}.", "The cappuccino waits for a time (for example 2 s), but this is {0}."],
  // ------------------------------------------------------------ blocchi dell'engine
  "block.noHost": ["«blocco» si usa solo dentro Pepino Engine (scheda Codice).", "\"block\" can only be used inside Pepino Engine (Code tab)."],
  "block.propType": ["Una proprietà può essere un Numero, un Testo, un SiNo, una scelta o uno dei tipi dell'engine ({0}).", "A property can be a Number, a Text, a YesNo, a choice or one of the engine's types ({0})."],
  "block.propConst": ["Il valore iniziale di una proprietà deve essere fisso (un numero, un testo, vero/falso…).", "A property's starting value must be fixed (a number, a text, true/false…)."],
  "block.unknownEvent": ["Il blocco non ha l'evento «{0}»: aggiungi in alto «evento {0}».", "The block has no event \"{0}\": add \"event {0}\" at the top."],
  "block.emitOutside": ["«emetti» si usa solo dentro un blocco.", "\"emit\" can only be used inside a block."],
  "block.unknownRequire": ["Non conosco il blocco «{0}».", "I don't know the block \"{0}\"."],
  "block.conditionReturn": ["Una condizione deve restituire vero o falso con «ritorna».", "A condition must return true or false with \"return\"."],
  "block.paramType": ["I parametri di azioni e condizioni possono essere Numero, Testo o SiNo (o un tipo dell'engine).", "Action and condition parameters can be Number, Text or YesNo (or an engine type)."],
  // ------------------------------------------------------------ esecuzione
  "run.index": ["La posizione {0} non esiste: {1} ha {2} elementi (le posizioni partono da 1).", "Position {0} doesn't exist: {1} has {2} elements (positions start at 1)."],
  "run.indexInt": ["Le posizioni devono essere numeri interi: {0} non va bene.", "Positions must be whole numbers: {0} won't do."],
  "run.mapKey": ["La mappa non ha la chiave {0}.", "The map has no key {0}."],
  "run.divZero": ["Non si può dividere per zero.", "You can't divide by zero."],
  "run.nothing": ["Il valore è niente.", "The value is nothing."],
  "run.check": ["Il controllo è fallito: {0}", "The check failed: {0}"],
  "run.checkPlain": ["Il controllo è fallito (riga {0}).", "The check failed (line {0})."],
  "run.number": ["«{0}» non è un numero.", "\"{0}\" is not a number."],
  "run.emptyList": ["La lista è vuota.", "The list is empty."],
  "run.tooDeep": ["La funzione chiama sé stessa troppe volte (forse non si ferma mai).", "The function calls itself too many times (maybe it never stops)."],
  "run.noInput": ["Qui non si può chiedere niente all'utente.", "Nothing can be asked to the user here."],
  "run.inputEnded": ["Non c'è più niente da leggere dalla tastiera.", "There's nothing more to read from the keyboard."],
  "run.noFiles": ["Qui non si possono leggere o scrivere file.", "Files can't be read or written here."],
  "run.moved": ["Il valore era stato spostato.", "The value had been moved."],
  "run.step": ["Il passo non può essere zero.", "The step can't be zero."],
  "run.tooLong": ["Il programma sta girando da troppo tempo senza fermarsi.", "The program has been running for too long without stopping."],
  "run.panic": ["Mamma mia! {0}", "Mamma mia! {0}"],
  "run.panicPlain": ["Mamma mia! È successo qualcosa che non doveva succedere (riga {0}).", "Mamma mia! Something happened that should never happen (line {0})."],
};

export function messageTemplate(key: string, lang: Lang): string {
  const m = MESSAGES[key];
  if (!m) return key;
  return lang === "it" ? m[0] : m[1];
}

export function renderArg(a: MsgArg, lang: Lang): string {
  return typeof a === "function" ? a(lang) : String(a);
}

export function formatMessage(key: string, args: MsgArg[], lang: Lang): string {
  return messageTemplate(key, lang).replace(/\{(\d+)\}/g, (_, n) => (Number(n) < args.length ? renderArg(args[Number(n)], lang) : `{${n}}`));
}

export function renderDiagnostics(list: Diagnostic[], lang: Lang): Diagnostic[] {
  for (const d of list) d.message = formatMessage(d.key, d.args, lang);
  return list;
}

export const hasMessage = (key: string) => key in MESSAGES;

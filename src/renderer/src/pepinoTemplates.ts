/** Il modello di un nuovo script in Pepino Language (in italiano o in inglese, come l'editor). */
export function pepTemplate(name: string, lang: "it" | "en"): string {
  if (lang === "en")
    return `# A block written in Pepino Language: find it in the Inspector, under "Add block" → Custom.
# Its actions, conditions and events show up in the Rules.
block ${name} "Stroll":
    description "Walks back and forth, with a pause at each side."
    property distance = 3 tile, "Distance", from 0 to 20
    property speed = 2 tile/s, "Speed", from 0 to 20
    property pause = 0.5 s, "Pause at the sides"
    event lap "Finished a lap"

    start_x = 0
    stopped = false

    on start:
        start_x = object.x
        repeat:
            walk_to(start_x + distance)
            wait pause
            walk_to(start_x)
            wait pause
            emit lap

    # One step per frame towards "target" (a plain "wait" goes on at the next frame).
    function walk_to(target: Number):
        while object.x != target:
            if not stopped:
                object.x = approach(object.x, target, speed * dt)
            wait

    action stop "Stop":
        stopped = true

    action restart "Start again":
        stopped = false

    condition is_stopped "Is stopped":
        return stopped
`;
  return `# Un blocco scritto in Pepino Language: lo trovi nell'Inspector, in «Aggiungi blocco» → Personalizzati.
# Le sue azioni, condizioni ed eventi compaiono nelle Regole.
blocco ${name} "Passeggia":
    descrizione "Va avanti e indietro, con una pausa a ogni lato."
    proprietà distanza = 3 tile, "Distanza", da 0 a 20
    proprietà velocità = 2 tile/s, "Velocità", da 0 a 20
    proprietà pausa = 0.5 s, "Pausa ai lati"
    evento giro "Ha finito un giro"

    partenza = 0
    fermo = falso

    quando inizia:
        partenza = oggetto.x
        ripeti:
            cammina_fino_a(partenza + distanza)
            aspetta pausa
            cammina_fino_a(partenza)
            aspetta pausa
            emetti giro

    # Un passo per fotogramma verso «meta» (un «aspetta» da solo continua al fotogramma dopo).
    funzione cammina_fino_a(meta: Numero):
        mentre oggetto.x != meta:
            se non fermo:
                oggetto.x = avvicina(oggetto.x, meta, velocità * dt)
            aspetta

    azione ferma "Fermati":
        fermo = vero

    azione riparti "Riparti":
        fermo = falso

    condizione è_fermo "È fermo":
        ritorna fermo
`;
}

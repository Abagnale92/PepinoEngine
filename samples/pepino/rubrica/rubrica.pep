# Un programma su più file: «usa» prende tipi e funzioni da contatti.pep.
usa "contatti.pep"

rubrica = [Contatto("Anna", "333 111"), Contatto("Bruno", "333 222")]
per ogni c in rubrica:
    mostra(c)

trovato = cerca(rubrica, "Bruno")
se trovato != niente:
    scrivi("Trovato: {trovato.telefono}")

prova "cerca un contatto che non c'è":
    controlla cerca(rubrica, "Zeno") = niente

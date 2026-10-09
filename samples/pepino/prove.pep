# Le prove: piccoli controlli che il programma fa quello che deve.
funzione media(voti: Lista di Numero) -> Numero:
    se voti.vuota:
        ritorna 0
    ritorna voti.somma() / voti.lunghezza

prova "media di tre voti":
    controlla media([6, 7, 8]) = 7

prova "media di nessun voto":
    controlla media([]) = 0

prova "questa prova sbaglia apposta":
    controlla media([10, 0]) = 10, "la media di 10 e 0 è 5"

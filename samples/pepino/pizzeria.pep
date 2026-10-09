# La pizzeria di Pepino: le cinque parole italiane che si scrivono uguali in italiano e in inglese.
#   pizza         crea un valore, un ingrediente per riga
#   spaghetti     una catena di passi: ogni riga riceve il risultato della riga prima
#   bravo         dopo «tenta … se errore»: parte solo se è andato tutto bene
#   cappuccino    qualcosa da fare più tardi, mentre il programma va avanti
#   mamma mia!    l'errore grave, che nessun «tenta» può fermare

tipo Pizza:
    nome: Testo
    prezzo = 6
    condimenti: Lista di Testo = []

# pizza: un ingrediente per riga (anche una pizza dentro l'altra)
margherita = pizza Pizza:
    nome = "Margherita"
    condimenti = pizza Lista:
        "pomodoro"
        "mozzarella"
        "basilico"

diavola = pizza Pizza:
    nome = "Diavola"
    prezzo = 7.5
    condimenti = ["pomodoro", "mozzarella", "salame piccante"]

menu = [margherita, diavola]

# spaghetti: i passi sono metodi del valore (trasforma, ordina…) o funzioni tue (in_euro)
funzione in_euro(n: Numero) -> Testo:
    ritorna "{arrotonda(n, 2)} €"

nomi = spaghetti menu:
    trasforma(p => p.nome)
    ordina()
    unisci(" e ")
scrivi("Oggi nel menù: {nomi}")

conto = spaghetti menu:
    trasforma(p => p.prezzo)
    somma()
    in_euro()
scrivi("Una di ciascuna: {conto}")

# tenta … se errore … bravo: «bravo» vede le variabili del tentativo
ordine = "3"
tenta:
    quante = numero(ordine)
se errore problema:
    scrivi("Non ho capito l'ordine: {problema}")
bravo:
    scrivi("Arrivano {quante} margherite: {in_euro(quante * margherita.prezzo)}")

# cappuccino: arriva tra un secondo, e intanto il programma va avanti
cappuccino 1 s:
    scrivi("Ecco il cappuccino!")
scrivi("Intanto si mangia la pizza…")

# mamma mia!: qualcosa che non deve succedere mai (prova a svuotare i condimenti di una pizza)
funzione cuoci(p: Pizza):
    se p.condimenti.vuota:
        mamma mia! "una pizza senza niente sopra"
    scrivi("{p.nome} in forno!")

per ogni p in menu:
    cuoci(p)

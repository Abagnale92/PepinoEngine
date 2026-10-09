# Numeri con le unità di misura: il compilatore controlla che i conti abbiano senso.
velocita = 4 tile/s
tempo = 3 s
strada = velocita * tempo          # una lunghezza
scrivi("In {tempo} secondi faccio {strada / 1 tile} tile")

giro = 90°
scrivi("seno di 90°: {sen(giro)}")

attesa = 500 ms
scrivi("mezzo secondo = {attesa} s")

# Prova a togliere il # qui sotto: Pepino ti dice che non si sommano tempi e lunghezze.
# sbagliato = tempo + strada

# Come Pepino gestisce la memoria: copie, spostamenti, prestiti e distruzione immediata.

tipo Zaino:
    nome: Testo
    oggetti: Lista di Testo = []

    quando crea:
        scrivi("  (nasce lo zaino di {nome})")
    quando finisce:
        scrivi("  (lo zaino di {nome} viene distrutto: si libera la memoria)")

# 1. Una copia è una fotocopia: cambiare la copia non cambia l'originale.
a = Zaino("Anna")
a.oggetti.aggiungi("mela")
b = a
b.nome = "Bruno"
b.oggetti.aggiungi("pera")
scrivi("Anna ha {a.oggetti}, Bruno ha {b.oggetti}")

# 2. «sposta» regala il valore senza copiarlo: il vecchio nome non si può più usare.
c = sposta b
scrivi("Ora lo zaino di Bruno si chiama c: {c.oggetti}")

# 3. I parametri sono prestiti: la funzione legge senza copiare e senza cambiare.
funzione conta(z: Zaino) -> Numero:
    ritorna z.oggetti.lunghezza

# «cambia» permette alla funzione di modificare la variabile di chi la chiama.
funzione riempi(cambia z: Zaino):
    z.oggetti.aggiungi("acqua")

riempi(cambia a)
scrivi("Anna ha {conta(a)} oggetti")

# 4. Quando una variabile finisce (alla fine della funzione), il suo valore viene distrutto subito.
funzione gita():
    z = Zaino("Gita")
    scrivi("  in gita con {conta(z)} oggetti")

gita()
scrivi("Fine del programma: ora si distruggono gli zaini rimasti.")

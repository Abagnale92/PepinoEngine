# Indovina il numero: il computer pensa un numero da 1 a 100.
segreto = casuale(1, 100)
tentativi = 0
scrivi("Ho pensato un numero da 1 a 100. Indovinalo!")

ripeti:
    n = chiedi_numero("Il tuo numero: ")
    tentativi += 1
    se n = segreto:
        scrivi("Bravo! Ci hai messo {tentativi} tentativi.")
        interrompi
    altrimenti se n < segreto:
        scrivi("Più grande!")
    altrimenti:
        scrivi("Più piccolo!")

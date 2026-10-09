# Un file con tipi e funzioni da usare in altri programmi (con «usa»).
tipo Contatto:
    nome: Testo
    telefono: Testo

funzione mostra(c: Contatto):
    scrivi("{c.nome}: {c.telefono}")

funzione cerca(lista: Lista di Contatto, nome: Testo) -> Contatto?:
    ritorna lista.trova(c => c.nome = nome)

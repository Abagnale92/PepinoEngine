# A tiny trattoria, written in English Pepino.
# Five Italian words work in every language: pizza, spaghetti, bravo, cappuccino, mamma mia!

type Dish:
    name: Text
    price = 8
    vegetarian = true

menu = pizza List:
    pizza Dish:
        name = "Margherita"
        price = 7
    pizza Dish:
        name = "Carbonara"
        price = 11
        vegetarian = false
    pizza Dish:
        name = "Tiramisù"
        price = 6

function euro(n: Number) -> Text:
    return "€ {round(n, 2)}"

veggie = spaghetti menu:
    filter(d => d.vegetarian)
    map(d => d.name)
    join(", ")
print("Veggie friendly: {veggie}")

bill = spaghetti menu:
    map(d => d.price)
    sum()
    euro()
print("One of everything: {bill}")

function serve(d: Dish):
    if d.price <= 0:
        mamma mia! "{d.name} can't be free!"
    print("Serving {d.name}...")

try:
    for each d in menu:
        serve(d)
if error problem:
    print("Kitchen trouble: {problem}")
bravo:
    print("Bravo! Every dish is on the table.")

cappuccino 2 s:
    print("☕ And now, a cappuccino.")
print("Buon appetito!")

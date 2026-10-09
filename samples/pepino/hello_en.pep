# The same language, with English words.
name = ask("What's your name? ")
print("Hi, {name}!")

type Pet:
    name: Text
    hunger = 5

    function feed(food: Number):
        hunger = max(0, hunger - food)

cat = Pet("Tom")
cat.feed(3)
print("{cat.name} is hungry: {cat.hunger}")

for each n from 1 to 3:
    print(n * n)

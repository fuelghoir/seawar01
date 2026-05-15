from game_logic import Game

def main():
    game = Game()
    game.setup_boards()
    print("Welcome to Battleship!")
    print("Your fleet has been deployed.")

    while True:
        if game.player_turn:
            print("\nYour turn!")
            try:
                row = int(input("Enter row (0-9): "))
                col = int(input("Enter column (0-9): "))
                if not (0 <= row < 10) or not (0 <= col < 10):
                    print("Invalid coordinates. Please enter values between 0 and 9.")
                    continue

                result, winner = game.player_attack(row, col)
                print(f"Attack result: {result}")

                if winner:
                    print("Congratulations! You won!")
                    break

            except EOFError:
                print("\nInput ended. Exiting game.")
                return
            except ValueError:
                print("Please enter valid numbers.")
                continue
        else:
            print("Computer's turn...")
            result, winner = game.computer_attack()
            print(f"Computer attacked and {result}.")

            if winner:
                print("Game over! Computer won.")
                break

if __name__ == "__main__":
    main()

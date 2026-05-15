from src.game_logic import Game

def main():
    print("Welcome to Battleship!")
    print("You will play against the computer.")
    print("Your ships are placed randomly on the board.")
    print("Enter coordinates (row, col) to attack the computer's ships.")
    print("The first to sink all enemy ships wins!")

    # Create and setup game
    game = Game()
    game.setup_boards()

    # Main game loop
    while not game.game_over:
        if game.player_turn:
            # Display boards
            print("\nYour board:")
            game.player_board.display(hide_ships=False)

            print("\nComputer's board:")
            game.computer_board.display(hide_ships=True)

            # Get player input
            try:
                row = int(input("\nEnter row to attack (0-9): "))
                col = int(input("Enter column to attack (0-9): "))

                # Validate input
                if row < 0 or row > 9 or col < 0 or col > 9:
                    print("Invalid coordinates! Please enter values between 0 and 9.")
                    continue

                # Process attack
                result, game_won = game.player_attack(row, col)
                print(f"\nAttack result: {result}")

                if game_won:
                    print("\nCongratulations! You won!")

            except EOFError:
                print("\nInput ended. Exiting game.")
                return
            except ValueError:
                print("Please enter valid numbers!")
            except Exception as e:
                print(f"An error occurred: {e}")
        else:
            print("\nComputer's turn...")
            result, game_won = game.computer_attack()
            print(f"Computer attacked and {result}")

            if game_won:
                print("\nGame over! Computer won!")

    # Show final boards
    print("\nFinal boards:")
    print("\nYour board:")
    game.player_board.display(hide_ships=False)

    print("\nComputer's board:")
    game.computer_board.display(hide_ships=False)

if __name__ == "__main__":
    main()

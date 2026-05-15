import random

class Ship:
    def __init__(self, name, size):
        self.name = name
        self.size = size
        self.positions = []
        self.hits = 0

    def place_ship(self, positions):
        self.positions = positions

    def hit(self):
        self.hits += 1
        return self.hits == self.size

    def is_sunk(self):
        return self.hits == self.size

class Board:
    def __init__(self):
        self.grid = [[" " for _ in range(10)] for _ in range(10)]
        self.ships = []

    def place_ship(self, ship, start_row, start_col, horizontal):
        positions = []

        # Check if ship placement is valid
        if horizontal:
            if start_col + ship.size > 10:
                return False

            for i in range(ship.size):
                if self.grid[start_row][start_col + i] != " ":
                    return False
                positions.append((start_row, start_col + i))
        else:
            if start_row + ship.size > 10:
                return False

            for i in range(ship.size):
                if self.grid[start_row + i][start_col] != " ":
                    return False
                positions.append((start_row + i, start_col))

        # Place the ship
        for row, col in positions:
            self.grid[row][col] = "S"
        ship.place_ship(positions)
        self.ships.append(ship)
        return True

    def receive_attack(self, row, col):
        if self.grid[row][col] == " " or self.grid[row][col] == "X" or self.grid[row][col] == "O":
            # Mark as miss
            self.grid[row][col] = "O"
            return "miss", False
        elif self.grid[row][col] == "S":
            # Mark as hit
            self.grid[row][col] = "X"

            # Check which ship was hit
            for ship in self.ships:
                if (row, col) in ship.positions:
                    is_sunk = ship.hit()
                    if is_sunk:
                        return f"hit and sunk {ship.name}", self.all_ships_sunk()
                    else:
                        return "hit", False

        return "miss", False

    def all_ships_sunk(self):
        return all(ship.is_sunk() for ship in self.ships)

    def display(self, hide_ships=True):
        print("  " + " ".join(str(i) for i in range(10)))
        for i, row in enumerate(self.grid):
            display_row = []
            for cell in row:
                if hide_ships and cell == "S":
                    display_row.append(" ")
                else:
                    display_row.append(cell)
            print(f"{i} {' '.join(display_row)}")

class Game:
    def __init__(self):
        self.player_board = Board()
        self.computer_board = Board()
        self.player_turn = True
        self.game_over = False

        # Define ships in order of size (largest to smallest)
        self.ships_config = [
            ("Aircraft Carrier", 5),
            ("Battleship", 4),
            ("Submarine", 3),
            ("Cruiser", 3),
            ("Destroyer", 2)
        ]

    def setup_boards(self):
        # Setup player ships (random placement)
        for name, size in self.ships_config:
            ship = Ship(name, size)
            placed = False
            while not placed:
                start_row = random.randint(0, 9)
                start_col = random.randint(0, 9)
                horizontal = random.choice([True, False])
                placed = self.player_board.place_ship(ship, start_row, start_col, horizontal)

        # Setup computer ships (random placement)
        for name, size in self.ships_config:
            ship = Ship(name, size)
            placed = False
            while not placed:
                start_row = random.randint(0, 9)
                start_col = random.randint(0, 9)
                horizontal = random.choice([True, False])
                placed = self.computer_board.place_ship(ship, start_row, start_col, horizontal)

    def player_attack(self, row, col):
        result, all_sunk = self.computer_board.receive_attack(row, col)
        if all_sunk:
            self.game_over = True
            return result, True
        self.player_turn = False
        return result, False

    def computer_attack(self):
        # Simple AI: random targeting
        while True:
            row = random.randint(0, 9)
            col = random.randint(0, 9)
            # In a more advanced version, we could implement smarter targeting
            # after a hit is detected
            result, all_sunk = self.player_board.receive_attack(row, col)
            if "invalid" not in result:  # Valid attack
                if all_sunk:
                    self.game_over = True
                    return result, True
                self.player_turn = True
                return result, False
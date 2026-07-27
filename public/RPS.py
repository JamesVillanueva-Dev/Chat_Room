"""
Author: James Villanueva

"""

import argparse
import json
import random
import sys

WIN_MESSAGE = "You win!"
LOSE_MESSAGE = "You lose!"
TIE_MESSAGE = "Tie!"
CHOICES = ("r", "p", "s")
CHOICE_NAMES = {
    "r": "rock",
    "p": "paper",
    "s": "scissors",
}
CHOICE_ALIASES = {
    "r": "r",
    "rock": "r",
    "p": "p",
    "paper": "p",
    "s": "s",
    "scissors": "s",
    "scissor": "s",
}
OUTCOMES = {
    ("r", "r"): TIE_MESSAGE,
    ("r", "p"): LOSE_MESSAGE,
    ("r", "s"): WIN_MESSAGE,
    ("p", "r"): WIN_MESSAGE,
    ("p", "p"): TIE_MESSAGE,
    ("p", "s"): LOSE_MESSAGE,
    ("s", "r"): LOSE_MESSAGE,
    ("s", "p"): WIN_MESSAGE,
    ("s", "s"): TIE_MESSAGE,
}


def normalize_choice(choice):
    normalized = choice.strip().lower()
    if normalized not in CHOICE_ALIASES:
        raise ValueError("Please put a valid input: (R, P, S)")

    return CHOICE_ALIASES[normalized]


def play_round(player_choice):
    player_choice = normalize_choice(player_choice)
    cpu_choice = random.choice(CHOICES)
    result = OUTCOMES[(player_choice, cpu_choice)]

    return {
        "playerChoice": player_choice,
        "playerChoiceName": CHOICE_NAMES[player_choice],
        "cpuChoice": cpu_choice,
        "cpuChoiceName": CHOICE_NAMES[cpu_choice],
        "result": result,
    }

class RPS:
    def __init__(self):
        self.playerScore = 0
        self.cpuScore = 0

    def play(self):
        
        print("What do you choose? (R, P, S)")

        inputValid = False
        while not inputValid:
            playerChoice = input()
            try:
                playerChoice = normalize_choice(playerChoice)
                inputValid = True
            except ValueError:
                print("Please put a valid input: (R, P, S)")

        round_result = play_round(playerChoice)
        cpuChoice = round_result["cpuChoice"]
        result = round_result["result"]
        print(f"CPU chose: {cpuChoice}")
        print(result)
        if result == WIN_MESSAGE:
            self.playerScore += 1
        if result == LOSE_MESSAGE:
            self.cpuScore += 1

        print(f"Score--> Player: {self.playerScore} CPU: {self.cpuScore} \n")

    def main(self) -> None:
        while True:
            self.play()


def main():
    parser = argparse.ArgumentParser(description="Play rock paper scissors.")
    parser.add_argument("--play", help="Play one round with r, p, s, rock, paper, or scissors.")
    args = parser.parse_args()

    if args.play:
        try:
            print(json.dumps(play_round(args.play)))
        except ValueError as error:
            print(json.dumps({"error": str(error)}), file=sys.stderr)
            sys.exit(1)
        return

    RPS().main()


if __name__ == "__main__":
    main()

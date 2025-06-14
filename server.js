// Filename: server.js
// This server now acts as the main game engine, creating and managing game state.

const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

// We need to tell Node.js how to import our game logic classes.
// In a real project, we would use module.exports in game.js. For simplicity here,
// we'll just include the class definitions directly.

// --- Start: Inlined from game.js ---
class Card {
    constructor(cardData) {
        this.id = cardData.id;
        this.name = cardData.name;
        this.manaCost = cardData.mana_cost;
        this.typeLine = cardData.type_line;
        this.oracleText = cardData.oracle_text;
        this.power = cardData.power;
        this.toughness = cardData.toughness;
        this.imageUris = cardData.image_uris;
    }
}

class Player {
    constructor(name, decklist) {
        this.name = name;
        this.life = 40;
        this.library = this.createDeck(decklist);
        this.hand = [];
        this.graveyard = [];
        this.battlefield = [];
        this.exile = [];
        this.shuffleLibrary();
    }

    createDeck(decklist) {
        const deck = [];
        decklist.forEach(cardInfo => {
            for (let i = 0; i < cardInfo.quantity; i++) {
                // The decklist passed in now contains the full card data
                deck.push(new Card(cardInfo.cardData));
            }
        });
        return deck;
    }

    shuffleLibrary() {
        console.log(`${this.name} is shuffling their library.`);
        for (let i = this.library.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.library[i], this.library[j]] = [this.library[j], this.library[i]];
        }
    }

    draw(numCards = 1) {
        for (let i = 0; i < numCards; i++) {
            if (this.library.length > 0) {
                const card = this.library.pop();
                this.hand.push(card);
                console.log(`${this.name} drew ${card.name}.`);
            } else {
                console.log(`${this.name} tried to draw a card, but their library is empty.`);
            }
        }
    }
}

class Game {
    constructor(playerConfigs) {
        this.players = playerConfigs.map(config => new Player(config.name, config.decklist));
        this.turn = 0;
        this.phase = 'beginning';
        this.step = 'untap';
        this.activePlayerIndex = 0;
        console.log("Game created with players:", this.players.map(p => p.name).join(', '));
    }

    startGame() {
        console.log("--- The game is starting! ---");
        this.players.forEach(player => {
            player.draw(7);
        });
        this.logGameState();
        // We won't start the turn loop automatically on the server yet.
    }
    
    logGameState() {
        console.log("--- Current Game State ---");
        this.players.forEach(player => {
            console.log(
                `${player.name} | Life: ${player.life} | Library: ${player.library.length} | Hand: ${player.hand.length}`
            );
        });
        console.log("--------------------------");
    }
}
// --- End: Inlined from game.js ---


const app = express();
const port = 3000;

app.use(cors()); 
app.use(express.json());

// This will hold our active game instance.
// For now, it only supports one game at a time.
let activeGame = null;

// Endpoint to create a new game from a deck URL
app.post('/create-game', async (req, res) => {
    const { deckUrl } = req.body;

    if (!deckUrl) {
        return res.status(400).json({ error: 'deckUrl is required' });
    }

    console.log(`Received request to create game with URL: ${deckUrl}`);

    try {
        // 1. Fetch the card names from Moxfield/Archidekt
        let simpleCardList;
        let deckApiUrl;
        let siteName;

        if (deckUrl.includes('moxfield.com/decks/')) {
            const deckId = deckUrl.split('/decks/')[1].split('/')[0];
            deckApiUrl = `https://api.moxfield.com/v2/decks/all/${deckId}`;
            siteName = 'Moxfield';
        } else if (deckUrl.includes('archidekt.com/decks/')) {
            const deckId = deckUrl.split('/decks/')[1].split('/')[0];
            deckApiUrl = `https://archidekt.com/api/decks/${deckId}/`;
            siteName = 'Archidekt';
        } else {
            return res.status(400).json({ error: 'Invalid or unsupported URL' });
        }

        console.log(`Fetching from ${siteName}: ${deckApiUrl}`);
        const apiResponse = await fetch(deckApiUrl);
        if (!apiResponse.ok) {
            throw new Error(`Failed to fetch from ${siteName}, status: ${apiResponse.status}`);
        }
        const deckData = await apiResponse.json();

        if (siteName === 'Moxfield') {
            simpleCardList = Object.values(deckData.mainboard).map(card => ({ name: card.card.name, quantity: card.quantity }));
        } else {
            simpleCardL
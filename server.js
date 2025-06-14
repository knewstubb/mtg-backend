// Filename: server.js
// This server now acts as the main game engine, creating and managing game state.
// New in this version: Logic to advance the game turn/phase via a new endpoint.

const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

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
        this.turn = 1; // Start at turn 1
        this.phaseOrder = ['beginning', 'precombat main', 'combat', 'postcombat main', 'ending'];
        this.stepOrder = {
            beginning: ['untap', 'upkeep', 'draw'],
            combat: ['beginning of combat', 'declare attackers', 'declare blockers', 'combat damage', 'end of combat'],
            ending: ['end', 'cleanup']
        };
        this.phaseIndex = 0;
        this.stepIndex = -1; // Start before the first step
        this.activePlayerIndex = 0;
        console.log("Game created with players:", this.players.map(p => p.name).join(', '));
    }

    startGame() {
        console.log("--- The game is starting! ---");
        this.players.forEach(player => {
            player.draw(7);
        });
        this.logGameState();
    }
    
    // ** NEW **: This method advances the game to the next step or phase.
    advance() {
        const currentPhase = this.phaseOrder[this.phaseIndex];
        const stepsInPhase = this.stepOrder[currentPhase];

        if (stepsInPhase) { // Phases with steps (beginning, combat, ending)
            this.stepIndex++;
            if (this.stepIndex < stepsInPhase.length) {
                this.step = stepsInPhase[this.stepIndex];
                this.executeStepActions(this.step);
            } else {
                this.advanceToNextPhase();
            }
        } else { // Phases without steps (main phases)
             this.advanceToNextPhase();
        }
        
        console.log(`Advancing to: Turn ${this.turn}, Phase: ${this.getPhase()}, Step: ${this.getStep()}`);
        this.logGameState();
    }

    advanceToNextPhase() {
        this.phaseIndex++;
        this.stepIndex = -1; // Reset step index for the new phase
        if (this.phaseIndex >= this.phaseOrder.length) {
            // End of turn, start a new one
            this.phaseIndex = 0;
            this.turn++;
            this.activePlayerIndex = (this.activePlayerIndex + 1) % this.players.length;
        }
        this.phase = this.phaseOrder[this.phaseIndex];
        // Immediately advance to the first step of the new phase
        this.advance();
    }
    
    // ** NEW **: Executes automatic actions for a given step.
    executeStepActions(step) {
        const player = this.players[this.activePlayerIndex];
        if (step === 'draw' && this.turn > 0) { // Don't draw on turn 0 (setup)
            player.draw(1);
        }
        // More actions for untap, upkeep, etc., will be added here.
    }

    getPhase() { return this.phaseOrder[this.phaseIndex]; }
    getStep() { 
        const phase = this.getPhase();
        if (this.stepOrder[phase] && this.stepIndex >= 0) {
            return this.stepOrder[phase][this.stepIndex];
        }
        return 'main'; // For main phases
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
const port = process.env.PORT || 3000;

app.use(cors()); 
app.use(express.json());

let activeGame = null;

app.post('/create-game', async (req, res) => {
    const { deckUrl } = req.body;
    if (!deckUrl) return res.status(400).json({ error: 'deckUrl is required' });
    console.log(`Received request to create game with URL: ${deckUrl}`);

    try {
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

        const apiResponse = await fetch(deckApiUrl);
        if (!apiResponse.ok) throw new Error(`Failed to fetch from ${siteName}, status: ${apiResponse.status}`);
        const deckData = await apiResponse.json();

        if (siteName === 'Moxfield') {
            simpleCardList = Object.values(deckData.mainboard).map(card => ({ name: card.card.name, quantity: card.quantity }));
        } else {
            simpleCardList = deckData.cards.map(card => ({ name: card.card.oracleCard.name, quantity: card.quantity }));
        }

        const allIdentifiers = simpleCardList.map(card => ({ name: card.name }));
        const cardDataMap = new Map();
        const chunkSize = 75;
        for (let i = 0; i < allIdentifiers.length; i += chunkSize) {
            const chunk = allIdentifiers.slice(i, i + chunkSize);
            const scryfallResponse = await fetch('https://api.scryfall.com/cards/collection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifiers: chunk })
            });
            if (!scryfallResponse.ok) throw new Error('Failed to fetch a chunk of card data from Scryfall.');
            const scryfallCollection = await scryfallResponse.json();
            scryfallCollection.data.forEach(card => cardDataMap.set(card.name, card));
        }

        const fullDecklist = simpleCardList.map(item => ({
            quantity: item.quantity,
            cardData: cardDataMap.get(item.name)
        })).filter(item => item.cardData);

        const playerConfigs = [{ name: 'Player 1', decklist: fullDecklist }, { name: 'AI Opponent', decklist: fullDecklist }];
        activeGame = new Game(playerConfigs);
        activeGame.startGame();
        
        // Initial state sent after drawing hands
        res.json(getGameStateForClient(activeGame));

    } catch (error) {
        console.error('Game Creation Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ** NEW ENDPOINT **
app.post('/next-phase', (req, res) => {
    if (!activeGame) {
        return res.status(404).json({ error: "No active game found. Please create a game first." });
    }
    try {
        activeGame.advance();
        res.json(getGameStateForClient(activeGame));
    } catch (error) {
        console.error("Error advancing phase:", error);
        res.status(500).json({ error: "Failed to advance game state." });
    }
});

// ** NEW HELPER FUNCTION **
function getGameStateForClient(game) {
    if (!game) return null;
    const activePlayer = game.players[game.activePlayerIndex];
    return {
        turn: game.turn,
        phase: game.getPhase(),
        step: game.getStep(),
        activePlayerName: activePlayer.name,
        players: game.players.map(p => ({
            name: p.name,
            life: p.life,
            handCount: p.hand.length,
            libraryCount: p.library.length,
            graveyardCount: p.graveyard.length,
            hand: p.name === 'Player 1' ? p.hand : [] // Only send Player 1's hand to the client
        }))
    };
}


app.get('/health', (req, res) => {
    res.status(200).send('Server is running');
});

app.listen(port, '0.0.0.0', () => {
    console.log(`MTG Game Server listening on port ${port}`);
});

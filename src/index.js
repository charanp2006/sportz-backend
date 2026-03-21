import express from 'express';
import { matchesRouter } from './routes/matches.js';

const app = express();
const PORT = 8000;

app.use(express.json());

app.get('/', (req, res) => {
	res.send('Server is running');
});

app.use('/api/matches', matchesRouter);

app.listen(PORT, () => {
	console.log(`Server running at http://localhost:${PORT}`);
});
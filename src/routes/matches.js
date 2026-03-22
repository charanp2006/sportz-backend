import { Router } from "express";
import { createMatchSchema, listMatchesQuerySchema } from "../validation/matches.js";
import { matches } from "../db/schema.js";
import { db } from "../db/db.js";
import { getMatchStatus } from "../utils/match-status.js";
import { desc } from "drizzle-orm";

export const matchesRouter = Router();

const MAX_LIMIT = 100;

matchesRouter.get("/", async (req, res) => {
    const parsed = listMatchesQuerySchema.safeParse(req.query);

    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid query parameters", details: parsed.error.issues });
    }

    const limit = Math.min(parsed.data.limit ?? 50, MAX_LIMIT);

    try {
        const data = await db
        .select()
        .from(matches)
        .orderBy((desc(matches.createdAt)))
        .limit(limit);

        res.json({ data });
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch matches" });
    }

});

matchesRouter.post("/", async (req, res) => {

    const parsed = createMatchSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid payload", details: parsed.error.issues });
    }

    const { data: {startTime, endTime, homeScore, awayScore} } = parsed;

    // //logging and error handling
    // console.log(req.body);
    // console.log(parsed);
    
    try {
        const [event] = await db.insert(matches).values({
            ...parsed.data,
            startTime: new Date(startTime),
            endTime: new Date(endTime),
            homeScore: homeScore ?? 0,
            awayScore: awayScore ?? 0,
            status: getMatchStatus(startTime, endTime)
        }).returning();

        if(res.app.locals.broadcastMatchCreated) {
            try {
                res.app.locals.broadcastMatchCreated(event);
            } catch (error) {
                console.error('Failed to broadcast match creation:', err);
                
            }
        }

        res.status(201).json({ message: "Match created successfully", data: event });
    } catch (error) {
        res.status(500).json({ error: "Failed to create match" });
    }
});

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

let pipelines = [];

//Retrieve REST API requests (Post)
app.post("/api/pipelines", (req, res) => {
    const pipeline = req.body;

    if(!pipeline || typeof pipeline !== "object") {
        return res.status(400).json({ error: "Invalid JSON body" });
    }

    const stored = {
        id: Date.now().toString(),
        createdAt: new Date().toISOString(),
        ...pipeline,
    };

    pipelines.push(stored);

    res.status(201).json({
        message: "Pipeline stored succcessfully",
        id: stored.id,
    });
});
app.get("/", (req,res) => {
    console.log()
});

app.get("/api/pipelines", (req, res) => {
    res.json(pipelines);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`Server running on https://localhost:${PORT}`);
});
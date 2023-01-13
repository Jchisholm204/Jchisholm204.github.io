const express = require('express');
const app = express();
const path = require('path');
const router = express.Router();
const device = require("express-device");

const hostname = 'localhost'
const port = 80;

router.use(express.static(__dirname + '/public'));
router.use(express.static(__dirname + '/public/styles'));


router.get('/', (req, res) => {
    res.sendFile(__dirname + "/public/index.html");
});

router.get('/device', (req, res) => {
    res.send(req.device.type);
});

app.use(device.capture());

router.use((req, res) => {
    res.sendFile(__dirname + "/public/pages/404.html");
});

app.use(express.static("public"));

app.use('/', router);

app.listen(port, () => {
    console.log(`Server running at ${hostname}:${port}`);
    console.log(__dirname);
});
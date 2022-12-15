const express = require('express');
const app = express();
const path = require('path');
const router = express.Router();

const hostname = '127.0.0.1'
const port = 1337;

router.use(express.static(__dirname + '/public'));
router.use(express.static(__dirname + '/public/styles'));


router.get('/', (req, res) => {
    res.sendFile(__dirname + "/public/index.html");
});

router.use((req, res) => {
    res.sendFile(__dirname + "/public/404.html");
});

app.use('/', router);

app.listen(port, hostname, () => {
    console.log(`Server running at ${hostname}:${port}`);
    console.log(__dirname);
});
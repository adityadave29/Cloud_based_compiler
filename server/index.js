const http = require('http');
const express = require('express');
const { Server: SocketServer } = require('socket.io');
const fs = require('fs/promises');
const path = require('path');
const cors = require('cors');
const pty = require('node-pty');
const chokidar = require('chokidar');
const { doSomeHeavyTask } = require("./utils");
const client = require('prom-client'); 

const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ register: client.register });

// Set the user directory
const USER_DIR = path.resolve(process.env.INIT_CWD || __dirname, './user');

const customShellScript = `
function cd() {
    local target_dir
    if [[ -z "$1" || "$1" == "." ]]; then
        target_dir=$(pwd)
    elif [[ "$1" == ".." ]]; then
        target_dir=$(realpath "$(pwd)/..")
    else
        target_dir=$(realpath "$(pwd)/$1")
    fi

    # Ensure the target directory is within the user directory
    if [[ $target_dir == ${USER_DIR}* ]]; then
        builtin cd "$target_dir"
    else
        echo "Access denied: Cannot navigate outside the user directory"
    fi
}
PS1="restricted-shell$ "; export PS1
cd "${USER_DIR}"
`;

(async () => {
    await fs.writeFile(path.join(USER_DIR, '.restricted_bashrc'), customShellScript, 'utf-8');
})();

// Spawn a pseudo-terminal process with the restricted shell
const ptyProcess = pty.spawn('bash', ['--rcfile', path.join(USER_DIR, '.restricted_bashrc')], {
    name: 'xterm-color',
    cols: 80,
    rows: 30,
    cwd: USER_DIR, 
    env: { ...process.env, HOME: USER_DIR }, 
});

const app = express();
const server = http.createServer(app);

const io = new SocketServer({
    cors: '*', 
});

app.use(cors());
io.attach(server);

chokidar.watch(USER_DIR).on('all', (event, filePath) => {
    io.emit('file:refresh', path.relative(USER_DIR, filePath));
});

ptyProcess.onData(data => {
    io.emit('terminal:data', data);
});

io.on('connection', (socket) => {
    console.log(`Socket connected:`, socket.id);

    socket.emit('file:refresh');

    socket.on('terminal:write', (data) => {
        console.log('Terminal input:', data);

        // Pass input directly to the pty process
        ptyProcess.write(data);
    });

    socket.on('file:change', async ({ path: filePath, content }) => {
        const absolutePath = path.resolve(USER_DIR, `.${filePath}`);
        if (!absolutePath.startsWith(USER_DIR)) {
            console.log('Unauthorized file access attempt:', absolutePath);
            socket.emit('terminal:data', 'Access denied: Cannot access files outside the user directory\n');
            return;
        }
        await fs.writeFile(absolutePath, content);
    });
});

// Serve file tree
app.get("/", (req, res) => {
    res.send("Welcome to the server!");
});

app.get("/slow", async (req, res) => {
    try {
        if (typeof doSomeHeavyTask !== "function") {
            throw new Error("doSomeHeavyTask is not implemented or incorrectly imported");
        }
        const timeTaken = await doSomeHeavyTask(); // Ensure this resolves to a number
        return res.json({
            status: "success",
            message: `Heavy task completed in ${timeTaken} milliseconds`,
        });
    } catch (error) {
        return res.status(500).json({
            status: "error",
            message: error.message,
        });
    }
});


app.get("/metrics", async (req, res) => {
    res.setHeader("Content-Type", client.register.contentType); // Correct header
    try {
        const metrics = await client.register.metrics(); // Retrieve metrics
        res.send(metrics);
    } catch (error) {
        res.status(500).json({ status: "error", message: error.message });
    }
});

app.get('/files', async (req, res) => {
    const fileTree = await generateFileTree(USER_DIR);
    return res.json({ tree: fileTree });
});

app.get('/files/content', async (req, res) => {
    const filePath = path.resolve(USER_DIR, `.${req.query.path}`);
    if (!filePath.startsWith(USER_DIR)) {
        return res.status(403).json({ error: 'Access denied' });
    }
    const content = await fs.readFile(filePath, 'utf-8');
    return res.json({ content });
});

server.listen(9000,'0.0.0.0', () => console.log(`🐳 Server running on port 9000`));

async function generateFileTree(directory) {
    const tree = {};

    async function buildTree(currentDir, currentTree) {
        const files = await fs.readdir(currentDir);

        for (const file of files) {
            const filePath = path.join(currentDir, file);
            const stat = await fs.stat(filePath);

            if (stat.isDirectory()) {
                currentTree[file] = {};
                await buildTree(filePath, currentTree[file]);
            } else {
                currentTree[file] = null;
            }
        }
    }

    await buildTree(directory, tree);
    return tree;
}

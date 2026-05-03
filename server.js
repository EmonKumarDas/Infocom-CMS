const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const ExcelJS = require('exceljs');
const multer = require('multer');
const crypto = require('crypto');
const https = require('https');
const { execSync } = require('child_process');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

let sseClients = [];
const notifyClients = () => {
    sseClients.forEach(client => client.res.write(`data: update\n\n`));
};

// Basic in-memory session store
const sessions = {};

// Auth Middleware
const requireAuth = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token || !sessions[token]) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = sessions[token];
    next();
};

const requireAdmin = (req, res, next) => {
    requireAuth(req, res, () => {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Forbidden: Admin only' });
        }
        next();
    });
};

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
    const [salt, key] = storedHash.split(':');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return key === hash;
}

const DB_PATH = path.join(__dirname, 'database.sqlite');
const EXCEL_TEMPLATE_PATH = path.join(__dirname, 'Copy of 1-CT All Conveyance Bill.xlsx');
let db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) console.error(err.message);
    else console.log('Connected to the SQLite database.');
});

// Initialize Tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_name TEXT NOT NULL,
        amount REAL NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_desc TEXT NOT NULL,
        location_id INTEGER,
        date TEXT,
        start_time TEXT,
        end_time TEXT,
        is_completed INTEGER DEFAULT 0,
        FOREIGN KEY (location_id) REFERENCES locations(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS task_employees (
        task_id INTEGER,
        employee_id INTEGER,
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (employee_id) REFERENCES employees(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_type TEXT,
        client_name TEXT,
        location TEXT,
        aktl_assign_router TEXT,
        client_id TEXT,
        bw_type TEXT,
        sales_kam TEXT,
        sales_bw TEXT,
        total_nttn TEXT,
        aktl_nttn TEXT,
        fgl_nttn TEXT,
        scl_nttn TEXT,
        datomato_nttn TEXT,
        last_mile_connected TEXT,
        client_end_device TEXT,
        nttn_link_id TEXT,
        handover_date TEXT,
        discontinue_date TEXT,
        vlan TEXT,
        asn TEXT,
        ip_user_info TEXT,
        lan_ip TEXT,
        mrtg TEXT,
        contact TEXT,
        email TEXT,
        address TEXT,
        router_login TEXT,
        remarks TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS inv_products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS inv_receive (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER,
        variant TEXT,
        quantity INTEGER,
        source_office TEXT DEFAULT 'Dhaka',
        notes TEXT,
        extra_fields TEXT,
        date TEXT,
        FOREIGN KEY (product_id) REFERENCES inv_products(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS inv_invest (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER,
        variant TEXT,
        quantity INTEGER,
        office TEXT,
        notes TEXT,
        extra_fields TEXT,
        date TEXT,
        FOREIGN KEY (product_id) REFERENCES inv_products(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        user_id TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        permissions TEXT DEFAULT '[]'
    )`);

    // Add permissions column if it doesn't exist (for existing databases)
    db.run(`ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT '[]'`, (err) => {
        // Ignore error if column already exists
    });

    db.run(`ALTER TABLE inv_receive ADD COLUMN total_cost REAL DEFAULT 0`, (err) => {});
    db.run(`ALTER TABLE inv_invest ADD COLUMN total_cost REAL DEFAULT 0`, (err) => {});

    db.run(`CREATE TABLE IF NOT EXISTS inv_sent_cuet (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER,
        variant TEXT,
        quantity INTEGER,
        notes TEXT,
        extra_fields TEXT,
        date TEXT,
        FOREIGN KEY (product_id) REFERENCES inv_products(id)
    )`);

    const initialProducts = ["Cable Tie", "Patch Cord", "TJB", "Fiber", "MC", "ONU", "Splitter", "SFP"];
    initialProducts.forEach(p => {
        db.run(`INSERT OR IGNORE INTO inv_products (name) VALUES (?)`, [p]);
    });
});

// --- API ROUTES ---

// --- AUTH ROUTES ---
app.get('/api/realtime/dashboard', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const client = { id: Date.now(), res };
    sseClients.push(client);
    req.on('close', () => { sseClients = sseClients.filter(c => c.id !== client.id); });
});

app.get('/api/auth/check', (req, res) => {
    db.get(`SELECT COUNT(*) as count FROM users WHERE role = 'admin'`, [], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ initialized: row.count > 0 });
    });
});

app.post('/api/auth/init', (req, res) => {
    const { username, user_id, password } = req.body;
    db.get(`SELECT COUNT(*) as count FROM users WHERE role = 'admin'`, [], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row.count > 0) return res.status(400).json({ error: 'Admin already exists.' });
        
        const hashedPw = hashPassword(password);
        db.run(`INSERT INTO users (username, user_id, password, role) VALUES (?, ?, ?, 'admin')`, 
            [username, user_id, hashedPw], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id: this.lastID });
        });
    });
});

app.post('/api/auth/login', (req, res) => {
    const { user_id, password } = req.body;
    db.get(`SELECT * FROM users WHERE user_id = ?`, [user_id], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user || !verifyPassword(password, user.password)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = crypto.randomBytes(32).toString('hex');
        sessions[token] = { id: user.id, username: user.username, role: user.role };
        res.json({ token, role: user.role, username: user.username, permissions: user.permissions });
    });
});

app.get('/api/auth/users', requireAdmin, (req, res) => {
    db.all(`SELECT id, username, user_id, role, permissions FROM users`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/auth/users', requireAdmin, (req, res) => {
    const { username, user_id, password, role, permissions } = req.body;
    const hashedPw = hashPassword(password);
    const perms = permissions ? JSON.stringify(permissions) : '[]';
    db.run(`INSERT INTO users (username, user_id, password, role, permissions) VALUES (?, ?, ?, ?, ?)`, 
        [username, user_id, hashedPw, role || 'user', perms], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, username, user_id, role: role || 'user', permissions: perms });
    });
});

app.put('/api/auth/users/:id', requireAdmin, (req, res) => {
    const { username, user_id, password, role, permissions } = req.body;
    const perms = permissions ? JSON.stringify(permissions) : '[]';
    
    if (password) {
        const hashedPw = hashPassword(password);
        db.run(`UPDATE users SET username = ?, user_id = ?, password = ?, role = ?, permissions = ? WHERE id = ?`,
            [username, user_id, hashedPw, role || 'user', perms, req.params.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, updated: this.changes });
        });
    } else {
        db.run(`UPDATE users SET username = ?, user_id = ?, role = ?, permissions = ? WHERE id = ?`,
            [username, user_id, role || 'user', perms, req.params.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, updated: this.changes });
        });
    }
});

app.delete('/api/auth/users/:id', requireAdmin, (req, res) => {
    db.run(`DELETE FROM users WHERE id = ?`, req.params.id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ deleted: this.changes });
    });
});
// Apply auth middleware to all other API routes
app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/auth')) return next();
    requireAuth(req, res, next);
});

// Employees
app.get('/api/employees', (req, res) => {
    db.all(`SELECT * FROM employees`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});
app.post('/api/employees', (req, res) => {
    const { name } = req.body;
    db.run(`INSERT INTO employees (name) VALUES (?)`, [name], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, name });
    });
});
app.put('/api/employees/:id', (req, res) => {
    const { name } = req.body;
    db.run(`UPDATE employees SET name = ? WHERE id = ?`, [name, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ updated: this.changes });
    });
});
app.delete('/api/employees/:id', (req, res) => {
    db.run(`DELETE FROM employees WHERE id = ?`, req.params.id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ deleted: this.changes });
    });
});

// Locations
app.get('/api/locations', (req, res) => {
    db.all(`SELECT * FROM locations`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});
app.post('/api/locations', (req, res) => {
    const { location_name, amount } = req.body;
    db.run(`INSERT INTO locations (location_name, amount) VALUES (?, ?)`, [location_name, amount], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, location_name, amount });
    });
});
app.put('/api/locations/:id', (req, res) => {
    const { location_name, amount } = req.body;
    db.run(`UPDATE locations SET location_name = ?, amount = ? WHERE id = ?`, [location_name, amount, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ updated: this.changes });
    });
});
app.delete('/api/locations/:id', (req, res) => {
    db.run(`DELETE FROM locations WHERE id = ?`, req.params.id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ deleted: this.changes });
    });
});

// Tasks
app.get('/api/tasks', (req, res) => {
    const query = `
        SELECT t.*, l.location_name, l.amount,
        GROUP_CONCAT(e.name) as employee_names 
        FROM tasks t
        LEFT JOIN locations l ON t.location_id = l.id
        LEFT JOIN task_employees te ON t.id = te.task_id
        LEFT JOIN employees e ON te.employee_id = e.id
        GROUP BY t.id
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});
app.post('/api/tasks', (req, res) => {
    const { task_desc, location_id, date, start_time, end_time, is_completed, employee_ids } = req.body;
    db.run(`INSERT INTO tasks (task_desc, location_id, date, start_time, end_time, is_completed) VALUES (?, ?, ?, ?, ?, ?)`,
        [task_desc, location_id, date, start_time, end_time, is_completed ? 1 : 0],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            const taskId = this.lastID;
            if (employee_ids && employee_ids.length > 0) {
                const placeholders = employee_ids.map(() => '(?, ?)').join(',');
                const values = employee_ids.reduce((acc, empId) => acc.concat([taskId, empId]), []);
                db.run(`INSERT INTO task_employees (task_id, employee_id) VALUES ${placeholders}`, values, (err2) => {
                    if (err2) return res.status(500).json({ error: err2.message });
                    res.json({ success: true, taskId });
                });
            } else {
                res.json({ success: true, taskId });
            }
        });
});

app.put('/api/tasks/:id', (req, res) => {
    const { task_desc, location_id, date, start_time, end_time, is_completed, employee_ids } = req.body;
    const taskId = req.params.id;
    db.run(`UPDATE tasks SET task_desc = ?, location_id = ?, date = ?, start_time = ?, end_time = ?, is_completed = ? WHERE id = ?`,
        [task_desc, location_id, date, start_time, end_time, is_completed ? 1 : 0, taskId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            
            // Delete old relations and insert new ones
            db.run(`DELETE FROM task_employees WHERE task_id = ?`, taskId, (err) => {
                if (err) return res.status(500).json({ error: err.message });
                if (employee_ids && employee_ids.length > 0) {
                    const placeholders = employee_ids.map(() => '(?, ?)').join(',');
                    const values = employee_ids.reduce((acc, empId) => acc.concat([taskId, empId]), []);
                    db.run(`INSERT INTO task_employees (task_id, employee_id) VALUES ${placeholders}`, values, (err2) => {
                        if (err2) return res.status(500).json({ error: err2.message });
                        res.json({ success: true, taskId });
                    });
                } else {
                    res.json({ success: true, taskId });
                }
            });
        });
});

app.delete('/api/tasks/:id', (req, res) => {
    const taskId = req.params.id;
    db.run(`DELETE FROM task_employees WHERE task_id = ?`, taskId, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        db.run(`DELETE FROM tasks WHERE id = ?`, taskId, function(err2) {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({ deleted: this.changes });
        });
    });
});

// Excel Export Conveyance
app.post('/api/export/conveyance', upload.single('template'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Excel Template file is required." });
        const month = req.body.month; // e.g. "2026-03"
        const templateBuffer = req.file.buffer;

        const query = `
            SELECT t.*, l.location_name, l.amount,
            GROUP_CONCAT(e.name) as employee_names 
            FROM tasks t
            LEFT JOIN locations l ON t.location_id = l.id
            LEFT JOIN task_employees te ON t.id = te.task_id
            LEFT JOIN employees e ON te.employee_id = e.id
            WHERE t.date LIKE ?
            GROUP BY t.id
            ORDER BY t.date ASC
        `;
        
        db.all(query, [month + '%'], async (err, tasks) => {
            if (err) return res.status(500).json({ error: err.message });

            // Build all task groups (each task = 4 rows: Up, Down, Up, Down)
            const allTaskGroups = [];
            tasks.forEach(task => {
                const date = task.date || '';
                const loc = task.location_name || '';
                const amount = task.amount || 0;
                const desc = task.task_desc || '';
                const emps = task.employee_names ? task.employee_names.replace(/,/g, ',\n') : '';

                allTaskGroups.push({ date, loc, amount, desc, emps });
            });

            // Split into pages: max 20 SL per page (each task = 4 SL, so 5 tasks per page)
            const SL_PER_PAGE = 20;
            const TASKS_PER_PAGE = Math.floor(SL_PER_PAGE / 4); // 5
            const pages = [];
            for (let i = 0; i < allTaskGroups.length; i += TASKS_PER_PAGE) {
                pages.push(allTaskGroups.slice(i, i + TASKS_PER_PAGE));
            }

            if (pages.length === 0) {
                // No data, return template as-is
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', 'attachment; filename="Export_Conveyance_' + month + '.xlsx"');
                const wb = new ExcelJS.Workbook();
                await wb.xlsx.load(templateBuffer);
                await wb.xlsx.write(res);
                res.end();
                return;
            }

            // Generate each Excel file (one per page)
            const excelBuffers = [];
            let globalSL = 1;

            for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
                const page = pages[pageIdx];
                const workbook = new ExcelJS.Workbook();
                await workbook.xlsx.load(templateBuffer);
                const sheet = workbook.getWorksheet(1);

                const insertRowPos = 10;
                const rowsToInsert = [];
                const taskGroups = [];
                let totalAmount = 0;

                page.forEach(task => {
                    const groupStartIdx = rowsToInsert.length;
                    totalAmount += task.amount * 4;

                    // 9 columns: SL, Date, From, To, Mode, Purpose, Up/Down, Total, Team Members
                    rowsToInsert.push([globalSL++, task.date, 'Office', task.loc, 'Rikshaw', task.desc, 'Up', task.amount, task.emps]);
                    rowsToInsert.push([globalSL++, task.date, task.loc, 'Office', 'Rikshaw', task.desc, 'Down', task.amount, task.emps]);
                    rowsToInsert.push([globalSL++, task.date, 'Office', task.loc, 'Rikshaw', task.desc, 'Up', task.amount, task.emps]);
                    rowsToInsert.push([globalSL++, task.date, task.loc, 'Office', 'Rikshaw', task.desc, 'Down', task.amount, task.emps]);

                    taskGroups.push({
                        startIdx: groupStartIdx,
                        endIdx: rowsToInsert.length - 1,
                        date: task.date,
                        desc: task.desc,
                        emps: task.emps
                    });
                });

                if (rowsToInsert.length > 0) {
                    // Clear existing merges in template data area first
                    const existingMerges = Object.keys(sheet._merges || {});
                    existingMerges.forEach(mergeRef => {
                        try {
                            const merge = sheet._merges[mergeRef];
                            if (merge) {
                                const mergeTop = merge.top || merge.model?.top;
                                const mergeBottom = merge.bottom || merge.model?.bottom;
                                if (mergeTop >= insertRowPos) {
                                    sheet.unMergeCells(mergeRef);
                                }
                            }
                        } catch(e) {}
                    });

                    sheet.spliceRows(insertRowPos, 0, ...rowsToInsert);
                    const newRowsEnd = insertRowPos + rowsToInsert.length - 1;

                    // Apply borders and alignment to all inserted rows (9 columns)
                    for (let r = insertRowPos; r <= newRowsEnd; r++) {
                        const row = sheet.getRow(r);
                        for (let c = 1; c <= 9; c++) {
                            const cell = row.getCell(c);
                            cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
                            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
                        }
                    }

                    // --- Per-task merging: Purpose (col 6) across 4 rows of each task ---
                    taskGroups.forEach(g => {
                        const startRow = insertRowPos + g.startIdx;
                        const endRow = insertRowPos + g.endIdx;
                        if (endRow > startRow) {
                            try { sheet.mergeCells(startRow, 6, endRow, 6); } catch(e) { console.error('Purpose merge error:', e.message); }
                        }
                    });

                    // --- Date (col 2) and Team Members (col 9) merging: merge all contiguous tasks with same date ---
                    let dateGroupStart = 0;
                    for (let i = 1; i <= taskGroups.length; i++) {
                        const prevDate = taskGroups[dateGroupStart].date;
                        const currDate = i < taskGroups.length ? taskGroups[i].date : null;

                        if (currDate !== prevDate) {
                            const mergeStartRow = insertRowPos + taskGroups[dateGroupStart].startIdx;
                            const mergeEndRow = insertRowPos + taskGroups[i - 1].endIdx;
                            if (mergeEndRow > mergeStartRow) {
                                // Merge Date column
                                try { sheet.mergeCells(mergeStartRow, 2, mergeEndRow, 2); } catch(e) { console.error('Date merge error:', e.message); }
                                // Merge Team Members column
                                try { sheet.mergeCells(mergeStartRow, 9, mergeEndRow, 9); } catch(e) { console.error('Team merge error:', e.message); }
                            }
                            dateGroupStart = i;
                        }
                    }
                }

                // Update Total sum and Taka in Words at the bottom
                for (let r = insertRowPos; r <= sheet.rowCount; r++) {
                    const row = sheet.getRow(r);
                    for (let c = 1; c <= 9; c++) {
                        const cellVal = String(row.getCell(c).value || '');
                        if (cellVal.trim() === 'Total') {
                            const targetCol = (c === 7) ? 8 : (c + 1);
                            row.getCell(targetCol).value = totalAmount;
                            row.getCell(targetCol).font = { bold: true };
                        }
                        if (cellVal.includes('Taka (In Word)')) {
                            row.getCell(2).value = numberToWords(totalAmount) + ' Taka Only';
                        }
                    }
                }

                const buffer = await workbook.xlsx.writeBuffer();
                excelBuffers.push(buffer);
            }

            if (excelBuffers.length === 1) {
                // Single file - return xlsx directly
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', 'attachment; filename="Export_Conveyance_' + month + '.xlsx"');
                res.send(Buffer.from(excelBuffers[0]));
            } else {
                // Multiple files - return JSON with base64 data for frontend to download each
                const files = excelBuffers.map((buf, idx) => ({
                    name: `Export_Conveyance_${month}_Part${idx + 1}.xlsx`,
                    data: Buffer.from(buf).toString('base64')
                }));
                res.json({ multiFile: true, files });
            }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Number to words helper
function numberToWords(amount) {
    const words = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
        "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
    const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
    
    if (amount === 0) return words[0];
    let word = "";
    
    if (Math.floor(amount / 1000) > 0) {
        word += numberToWords(Math.floor(amount / 1000)) + " Thousand ";
        amount %= 1000;
    }
    if (Math.floor(amount / 100) > 0) {
        word += words[Math.floor(amount / 100)] + " Hundred ";
        amount %= 100;
    }
    if (amount > 0) {
        if (amount < 20) word += words[amount];
        else {
            word += tens[Math.floor(amount / 10)];
            if (amount % 10 > 0) word += " " + words[amount % 10];
        }
    }
    return word.trim();
}

// Excel Export Food Bill
app.post('/api/export/food', upload.single('template'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Excel Template file is required." });
        const month = req.body.month; // e.g. "2026-03"
        const employee_id = req.body.employee_id;

        // Fetch Employee Name
        db.get(`SELECT name FROM employees WHERE id = ?`, [employee_id], async (err, empRow) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!empRow) return res.status(404).json({ error: "Employee not found." });
            
            const empName = empRow.name;

            const query = `
                SELECT t.*, l.location_name 
                FROM tasks t
                LEFT JOIN locations l ON t.location_id = l.id
                LEFT JOIN task_employees te ON t.id = te.task_id
                WHERE te.employee_id = ? AND t.date LIKE ?
                ORDER BY t.date ASC
            `;
            
            db.all(query, [employee_id, month + '%'], async (err, tasks) => {
                if (err) return res.status(500).json({ error: err.message });

                const workbook = new ExcelJS.Workbook();
                await workbook.xlsx.load(req.file.buffer);
                const sheet = workbook.getWorksheet(1);

                const [yyyy, mm] = month.split('-');
                const shortYear = yyyy.substring(2);
                const lastDay = new Date(yyyy, mm, 0).getDate();
                const currentDate = new Date().toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: '2-digit'}).replace(/ /g, '-'); 

                // Set Metadata Cells based on Image format
                sheet.getCell('A4').value = `Name : ${empName}`;
                sheet.getCell('D4').value = `Designation : CT`;
                sheet.getCell('A5').value = `Date : ${currentDate}`;
                sheet.getCell('D5').value = `Bill Period : 01-${mm}-${yyyy} to ${lastDay}-${mm}-${shortYear}`;
                sheet.getCell('A6').value = `ID : ${employee_id}`;
                sheet.getCell('D6').value = `Department : Technical (Infocom Ltd.)`;

                let insertRowPos = 10; 
                let sl = 1;
                let totalAmount = 0;
                
                const rowsToInsert = [];
                tasks.forEach(task => { // columns matching image
                    let dateStr = task.date || '';
                    if(dateStr.includes('-')) {
                        const parts = dateStr.split('-');
                        dateStr = `${parts[2]}/${parts[1]}/${parts[0]}`; // Convert to DD/MM/YYYY
                    }
                    const loc = task.location_name || '';
                    const desc = task.task_desc || '';
                    const st = task.start_time || '';
                    const et = task.end_time || '';
                    
                    const lunch = 80;
                    const dinner = 0;
                    const total = 80;
                    totalAmount += total;

                    rowsToInsert.push([sl++, dateStr, 'Office', loc, st, et, desc, lunch, dinner, total]);
                });

                if (rowsToInsert.length > 0) {
                    sheet.spliceRows(insertRowPos, 0, ...rowsToInsert);
                    const newRowsEnd = insertRowPos + rowsToInsert.length - 1;
                    for (let r = insertRowPos; r <= newRowsEnd; r++) {
                        const row = sheet.getRow(r);
                        for (let c = 1; c <= 10; c++) {
                            const cell = row.getCell(c);
                            cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
                            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
                        }
                    }
                }

                // Update Total sum and Total in words dynamically by searching for the labels
                for (let r = 1; r <= sheet.rowCount; r++) {
                    const row = sheet.getRow(r);
                    for (let c = 1; c <= 10; c++) {
                        const cellVal = String(row.getCell(c).value || '');
                        if (cellVal.includes('Total:')) {
                            row.getCell(10).value = totalAmount; 
                        }
                        if (cellVal.includes('Taka (In Word)')) {
                            row.getCell(2).value = numberToWords(totalAmount) + ' Taka Only';
                        }
                    }
                }

                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', `attachment; filename="Export_Food_${empName}_${month}.xlsx"`);
                await workbook.xlsx.write(res);
                res.end();
            });
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- Clients API ---
app.get('/api/clients', (req, res) => {
    db.all(`SELECT * FROM clients ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});
app.post('/api/clients', (req, res) => {
    const fields = Object.keys(req.body);
    const values = Object.values(req.body);
    if(fields.length === 0) return res.status(400).json({ error: "No fields provided" });
    const placeholders = fields.map(() => '?').join(',');
    db.run(`INSERT INTO clients (${fields.join(',')}) VALUES (${placeholders})`, values, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, ...req.body });
    });
});
app.put('/api/clients/:id', (req, res) => {
    const fields = Object.keys(req.body);
    const values = Object.values(req.body);
    if(fields.length === 0) return res.status(400).json({ error: "No fields provided" });
    const setters = fields.map(f => `${f} = ?`).join(',');
    values.push(req.params.id);
    db.run(`UPDATE clients SET ${setters} WHERE id = ?`, values, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, changes: this.changes });
    });
});
app.delete('/api/clients/:id', (req, res) => {
    db.run(`DELETE FROM clients WHERE id = ?`, req.params.id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ deleted: this.changes });
    });
});

app.post('/api/clients/upload', upload.single('excel'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Excel file is required." });
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(req.file.buffer);
        const sheet = workbook.getWorksheet(1);
        
        const dbColumns = [
            'client_type', 'client_name', 'location', 'aktl_assign_router', 'client_id', 'bw_type',
            'sales_kam', 'sales_bw', 'total_nttn', 'aktl_nttn', 'fgl_nttn', 'scl_nttn', 'datomato_nttn',
            'last_mile_connected', 'client_end_device', 'nttn_link_id', 'handover_date', 'discontinue_date',
            'vlan', 'asn', 'ip_user_info', 'lan_ip', 'mrtg', 'contact', 'email', 'address', 'router_login', 'remarks'
        ];
        
        let inserted = 0;
        // Assuming first row is header, data starts at row 2
        for (let r = 2; r <= sheet.rowCount; r++) {
            const row = sheet.getRow(r);
            let hasData = false;
            const rowData = {};
            dbColumns.forEach((col, idx) => {
                const val = row.getCell(idx + 1).value;
                if (val !== null && val !== undefined) hasData = true;
                rowData[col] = val !== null && val !== undefined ? String(val) : '';
            });
            
            if (hasData) {
                const fields = Object.keys(rowData);
                const values = Object.values(rowData);
                const placeholders = fields.map(() => '?').join(',');
                await new Promise((resolve, reject) => {
                    db.run(`INSERT INTO clients (${fields.join(',')}) VALUES (${placeholders})`, values, function(err) {
                        if (err) reject(err);
                        else { inserted++; resolve(); }
                    });
                });
            }
        }
        res.json({ success: true, count: inserted });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- INVENTORY API ---
app.get('/api/inventory/products', (req, res) => {
    db.all(`SELECT * FROM inv_products`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/inventory/products', (req, res) => {
    const { name } = req.body;
    if(!name) return res.status(400).json({ error: "Product name required" });
    db.run(`INSERT INTO inv_products (name) VALUES (?)`, [name], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, success: true });
    });
});

app.put('/api/inventory/products/:id', (req, res) => {
    const { name } = req.body;
    db.run(`UPDATE inv_products SET name = ? WHERE id = ?`, [name, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ updated: this.changes });
    });
});

app.delete('/api/inventory/products/:id', (req, res) => {
    db.run(`DELETE FROM inv_products WHERE id = ?`, req.params.id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ deleted: this.changes });
    });
});

app.get('/api/inventory/receive', (req, res) => {
    db.all(`SELECT r.*, p.name as product_name FROM inv_receive r JOIN inv_products p ON r.product_id = p.id ORDER BY r.id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/inventory/receive', (req, res) => {
    const { product_id, variant, quantity, source_office, notes, extra_fields, date, total_cost } = req.body;
    db.run(
        `INSERT INTO inv_receive (product_id, variant, quantity, source_office, notes, extra_fields, date, total_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [product_id, variant, quantity, source_office || 'Dhaka', notes, JSON.stringify(extra_fields || {}), date, total_cost || 0],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            notifyClients();
            res.json({ id: this.lastID, success: true });
        }
    );
});

app.delete('/api/inventory/receive/:id', (req, res) => {
    db.run(`DELETE FROM inv_receive WHERE id = ?`, req.params.id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        notifyClients();
        res.json({ deleted: this.changes });
    });
});

app.get('/api/inventory/invest', (req, res) => {
    db.all(`SELECT i.*, p.name as product_name FROM inv_invest i JOIN inv_products p ON i.product_id = p.id ORDER BY i.id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/inventory/invest', (req, res) => {
    const { product_id, variant, quantity, office, notes, extra_fields, date, total_cost } = req.body;
    db.run(
        `INSERT INTO inv_invest (product_id, variant, quantity, office, notes, extra_fields, date, total_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [product_id, variant, quantity, office, notes, JSON.stringify(extra_fields || {}), date, total_cost || 0],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            notifyClients();
            res.json({ id: this.lastID, success: true });
        }
    );
});

app.delete('/api/inventory/invest/:id', (req, res) => {
    db.run(`DELETE FROM inv_invest WHERE id = ?`, req.params.id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        notifyClients();
        res.json({ deleted: this.changes });
    });
});

app.get('/api/inventory/sent-cuet', (req, res) => {
    db.all(`SELECT s.*, p.name as product_name FROM inv_sent_cuet s JOIN inv_products p ON s.product_id = p.id ORDER BY s.id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/inventory/sent-cuet', (req, res) => {
    const { product_id, variant, quantity, notes, extra_fields, date } = req.body;
    db.run(
        `INSERT INTO inv_sent_cuet (product_id, variant, quantity, notes, extra_fields, date) VALUES (?, ?, ?, ?, ?, ?)`,
        [product_id, variant, quantity, notes, JSON.stringify(extra_fields || {}), date],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            notifyClients();
            res.json({ id: this.lastID, success: true });
        }
    );
});

app.delete('/api/inventory/sent-cuet/:id', (req, res) => {
    db.run(`DELETE FROM inv_sent_cuet WHERE id = ?`, req.params.id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        notifyClients();
        res.json({ deleted: this.changes });
    });
});

app.get('/api/inventory/stock', (req, res) => {
    const query = `
        SELECT 
            p.id as product_id,
            p.name as product_name,
            COALESCE(r.total_received, 0) as total_received,
            COALESCE(i_ctg.total_invested_ctg, 0) as total_invested_ctg,
            COALESCE(s.total_sent_cuet, 0) as total_sent_cuet,
            COALESCE(i_cuet.total_invested_cuet, 0) as total_invested_cuet
        FROM inv_products p
        LEFT JOIN (SELECT product_id, SUM(quantity) as total_received FROM inv_receive GROUP BY product_id) r ON p.id = r.product_id
        LEFT JOIN (SELECT product_id, SUM(quantity) as total_invested_ctg FROM inv_invest WHERE office = 'CTG' GROUP BY product_id) i_ctg ON p.id = i_ctg.product_id
        LEFT JOIN (SELECT product_id, SUM(quantity) as total_sent_cuet FROM inv_sent_cuet GROUP BY product_id) s ON p.id = s.product_id
        LEFT JOIN (SELECT product_id, SUM(quantity) as total_invested_cuet FROM inv_invest WHERE office = 'CUET' GROUP BY product_id) i_cuet ON p.id = i_cuet.product_id
    `;
    
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const stockData = rows.map(row => {
            const chittagong_stock = row.total_received - row.total_invested_ctg - row.total_sent_cuet;
            const cuet_stock = row.total_sent_cuet - row.total_invested_cuet;
            return {
                ...row,
                chittagong_stock,
                cuet_stock
            };
        });
        
        res.json(stockData);
    });
});

app.get('/api/inventory/dashboard', async (req, res) => {
    try {
        const monthFilter = req.query.month; // e.g. "2026-04"
        const isMonthStr = monthFilter ? `${monthFilter}%` : '%';
        
        const receives = await new Promise((resolve, reject) => {
            db.all(`SELECT product_id, variant, SUM(quantity) as total_qty, SUM(total_cost) as cost FROM inv_receive GROUP BY product_id, variant`, [], (err, rows) => {
                if(err) reject(err); else resolve(rows);
            });
        });

        const invests = await new Promise((resolve, reject) => {
            db.all(`SELECT product_id, variant, office, SUM(quantity) as total_qty, SUM(total_cost) as cost FROM inv_invest GROUP BY product_id, variant, office`, [], (err, rows) => {
                if(err) reject(err); else resolve(rows);
            });
        });

        const products = await new Promise((resolve, reject) => {
            db.all(`SELECT id, name FROM inv_products`, [], (err, rows) => {
                if(err) reject(err); else resolve(rows);
            });
        });

        const prodMap = {};
        products.forEach(p => prodMap[p.id] = p.name);

        let stockMap = {}; // { "prodId_variant": { prodName, variant, stock } }
        let totalReceivedCost = 0;
        let totalInvestedCost = 0;
        let chittagongInvestments = {};
        let cuetInvestments = {};
        
        receives.forEach(r => {
            const key = `${r.product_id}_${r.variant}`;
            stockMap[key] = {
                product_id: r.product_id,
                product_name: prodMap[r.product_id],
                variant: r.variant,
                received: r.total_qty,
                invested: 0,
                stock: r.total_qty,
                cost: r.cost || 0
            };
            totalReceivedCost += (r.cost || 0);
        });

        invests.forEach(i => {
            const key = `${i.product_id}_${i.variant}`;
            if(!stockMap[key]) {
                stockMap[key] = { product_id: i.product_id, product_name: prodMap[i.product_id], variant: i.variant, received: 0, invested: 0, stock: 0, cost: 0 };
            }
            stockMap[key].invested += i.total_qty;
            stockMap[key].stock -= i.total_qty;
            totalInvestedCost += (i.cost || 0);

            // Track location investments for matrix
            if (i.office === 'CTG') {
                chittagongInvestments[key] = (chittagongInvestments[key] || 0) + i.total_qty;
            } else if (i.office === 'CUET') {
                cuetInvestments[key] = (cuetInvestments[key] || 0) + i.total_qty;
            }
        });

        // Determine stock by location based on receives vs invests vs sent to cuet
        const sentCuets = await new Promise((resolve, reject) => {
            db.all(`SELECT product_id, variant, SUM(quantity) as total_qty FROM inv_sent_cuet GROUP BY product_id, variant`, [], (err, rows) => {
                if(err) reject(err); else resolve(rows);
            });
        });

        let cuetStockData = {};
        sentCuets.forEach(s => {
            const key = `${s.product_id}_${s.variant}`;
            cuetStockData[key] = s.total_qty;
        });

        // Build matrix data
        Object.keys(stockMap).forEach(key => {
            const sentToCuet = cuetStockData[key] || 0;
            const investedCtg = chittagongInvestments[key] || 0;
            const investedCuet = cuetInvestments[key] || 0;

            const ctg_stock = stockMap[key].received - investedCtg - sentToCuet;
            const cuet_stock = sentToCuet - investedCuet;

            stockMap[key].chittagong_stock = ctg_stock;
            stockMap[key].cuet_stock = cuet_stock;
        });

        // Current Month Metrics
        const monthlyRecv = await new Promise((resolve, reject) => {
            db.get(`SELECT SUM(quantity) as val FROM inv_receive WHERE date LIKE ?`, [isMonthStr], (err, row) => resolve(row ? (row.val||0) : 0));
        });
        const monthlyInv = await new Promise((resolve, reject) => {
            db.get(`SELECT SUM(quantity) as val FROM inv_invest WHERE date LIKE ?`, [isMonthStr], (err, row) => resolve(row ? (row.val||0) : 0));
        });

        let totalStockUnits = 0;
        let lowStockItems = [];
        Object.values(stockMap).forEach(s => {
            totalStockUnits += s.stock;
            if (s.stock < 10) lowStockItems.push(s);
        });

        res.json({
            stockMap: Object.values(stockMap),
            totalStockUnits,
            totalReceivedCost,
            totalInvestedCost,
            monthlyReceived: monthlyRecv,
            monthlyInvested: monthlyInv,
            lowStockItems
        });

    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// Excel Export Inventory Report
app.post('/api/export/inventory_report', upload.single('template'), async (req, res) => {
    // Generate simple excel from scratch since they don't have a template specified for inventory
    try {
        const month = req.body.month; // e.g. "2026-04"
        const isMonthStr = month ? `${month}%` : '%';

        const recv = await new Promise((res, rej) => db.all("SELECT r.*, p.name as product_name FROM inv_receive r JOIN inv_products p ON r.product_id = p.id WHERE r.date LIKE ?", [isMonthStr], (err, rows) => err ? rej(err) : res(rows)));
        const inv = await new Promise((res, rej) => db.all("SELECT i.*, p.name as product_name FROM inv_invest i JOIN inv_products p ON i.product_id = p.id WHERE i.date LIKE ?", [isMonthStr], (err, rows) => err ? rej(err) : res(rows)));

        // Aggregate
        const rep = {};
        recv.forEach(r => {
            const k = `${r.product_name}_${r.variant}`;
            if(!rep[k]) rep[k] = { name: r.product_name, variant: r.variant, recv: 0, inv_ctg: 0, inv_cuet: 0 };
            rep[k].recv += r.quantity;
        });
        inv.forEach(i => {
            const k = `${i.product_name}_${i.variant}`;
            if(!rep[k]) rep[k] = { name: i.product_name, variant: i.variant, recv: 0, inv_ctg: 0, inv_cuet: 0 };
            if(i.office === 'CTG') rep[k].inv_ctg += i.quantity;
            else if(i.office === 'CUET') rep[k].inv_cuet += i.quantity;
        });

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Monthly Report');
        
        sheet.columns = [
            { header: 'Product Name', key: 'name', width: 20 },
            { header: 'Type/Variation', key: 'variant', width: 25 },
            { header: 'Total Received', key: 'recv', width: 15 },
            { header: 'Total Used (CTG)', key: 'inv_ctg', width: 20 },
            { header: 'Total Used (CUET)', key: 'inv_cuet', width: 20 },
            { header: 'Remaining / Unadjusted', key: 'rem', width: 25 }
        ];

        // Apply styles to header
        sheet.getRow(1).font = { bold: true };
        sheet.getRow(1).alignment = { horizontal: 'center' };

        Object.values(rep).forEach(r => {
            sheet.addRow({
                name: r.name,
                variant: r.variant,
                recv: r.recv,
                inv_ctg: r.inv_ctg,
                inv_cuet: r.inv_cuet,
                rem: r.recv - (r.inv_ctg + r.inv_cuet)
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="Inventory_Report_' + (month||'All') + '.xlsx"');
        await workbook.xlsx.write(res);
        res.end();

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const PORT = 3000;
const HTTPS_PORT = 3443;
const HOST = '0.0.0.0';

// Auto-generate self-signed SSL cert if not present
const keyPath = path.join(__dirname, 'server.key');
const certPath = path.join(__dirname, 'server.cert');

function ensureSSLCerts() {
    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) return true;
    try {
        execSync(`openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/CN=InfocomCMS"`, { stdio: 'ignore' });
        console.log('✅ Self-signed SSL certificate generated.');
        return true;
    } catch(e) {
        console.log('⚠️  OpenSSL not found. Generating cert with Node.js crypto...');
        try {
            // Fallback: generate with Node.js built-in (requires Node 15+)
            const { generateKeyPairSync, createSign, createCertificate } = require('crypto');
            // Simple self-signed using forge-like approach not available natively
            // Use a minimal approach: create via spawn
            console.log('⚠️  Could not auto-generate SSL cert. Please run:');
            console.log(`   openssl req -x509 -newkey rsa:2048 -keyout server.key -out server.cert -days 365 -nodes -subj "/CN=InfocomCMS"`);
            return false;
        } catch(e2) {
            return false;
        }
    }
}

// Start HTTP server
app.listen(PORT, HOST, () => {
    console.log(`\n🌐 HTTP  Server: http://localhost:${PORT}`);
    const nets = require('os').networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                console.log(`   📱 Phone (HTTP): http://${net.address}:${PORT}`);
            }
        }
    }
});

// Start HTTPS server for camera access on phones
if (ensureSSLCerts()) {
    try {
        const sslOptions = {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath)
        };
        https.createServer(sslOptions, app).listen(HTTPS_PORT, HOST, () => {
            console.log(`\n🔒 HTTPS Server: https://localhost:${HTTPS_PORT}`);
            const nets = require('os').networkInterfaces();
            for (const name of Object.keys(nets)) {
                for (const net of nets[name]) {
                    if (net.family === 'IPv4' && !net.internal) {
                        console.log(`   📱 Phone (HTTPS + Camera): https://${net.address}:${HTTPS_PORT}`);
                    }
                }
            }
            console.log('\n💡 On your phone, open the HTTPS URL above.');
            console.log('   You will see a security warning — tap "Advanced" → "Proceed" to continue.\n');
        });
    } catch(e) {
        console.log('⚠️  HTTPS server failed to start:', e.message);
    }
} else {
    console.log('\n⚠️  HTTPS not available. Camera scanning will only work on localhost.');
    console.log('   To enable phone camera scanning, install OpenSSL and restart.\n');
}

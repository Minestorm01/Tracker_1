import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import { format, endOfMonth } from "date-fns";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("kpi_tracker.db");

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS daily_budgets (
    date TEXT PRIMARY KEY,
    total_budget REAL NOT NULL,
    total_hours REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rosters (
    staff_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    shift_hours REAL NOT NULL,
    PRIMARY KEY (staff_id, date),
    FOREIGN KEY (staff_id) REFERENCES staff(id)
  );

  CREATE TABLE IF NOT EXISTS sales_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    shift_hours REAL NOT NULL,
    actual_sales REAL NOT NULL,
    target_sales REAL NOT NULL,
    FOREIGN KEY (staff_id) REFERENCES staff(id),
    UNIQUE(staff_id, date)
  );

  CREATE TABLE IF NOT EXISTS repairs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_email TEXT,
    item_description TEXT NOT NULL,
    repair_category TEXT NOT NULL,
    condition_notes TEXT NOT NULL,
    risk_warnings TEXT,
    is_quoted INTEGER DEFAULT 0,
    quoted_price REAL,
    date_received TEXT NOT NULL,
    date_sent TEXT,
    date_due_back TEXT NOT NULL,
    jeweller TEXT,
    status TEXT NOT NULL DEFAULT 'Received',
    customer_contacted INTEGER DEFAULT 0,
    comms_notes TEXT
  );

  CREATE TABLE IF NOT EXISTS quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    inquiry_date TEXT NOT NULL,
    contact_phone TEXT,
    contact_email TEXT,
    contact_method TEXT NOT NULL,
    price_to_begin REAL,
    date_of_quote TEXT,
    quote_info TEXT NOT NULL,
    quoted_price REAL,
    customer_contacted INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Waiting on jeweller to quote',
    approved_date TEXT
  );

  CREATE TABLE IF NOT EXISTS special_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_quote_id INTEGER,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_email TEXT,
    item_description TEXT NOT NULL,
    stone_lab_nat TEXT,
    stone_shape TEXT,
    stone_carat REAL,
    stone_colour TEXT,
    stone_clarity TEXT,
    stone_report_no TEXT,
    stone_measurements TEXT,
    date_ordered TEXT NOT NULL,
    date_estimated TEXT NOT NULL,
    date_actual_ready TEXT,
    date_collected TEXT,
    status TEXT NOT NULL DEFAULT 'Ordered',
    comms_log TEXT,
    FOREIGN KEY (source_quote_id) REFERENCES quotes(id)
  );
`);

// Migration: Add new columns if they don't exist
const tableInfo = db.prepare("PRAGMA table_info(sales_entries)").all() as any[];
const columns = tableInfo.map(c => c.name);
if (!columns.includes('ips')) {
  db.exec("ALTER TABLE sales_entries ADD COLUMN ips REAL DEFAULT 0");
}
if (!columns.includes('avg_sale')) {
  db.exec("ALTER TABLE sales_entries ADD COLUMN avg_sale REAL DEFAULT 0");
}
if (!columns.includes('jcp_sales')) {
  db.exec("ALTER TABLE sales_entries ADD COLUMN jcp_sales REAL DEFAULT 0");
}

// Seed staff if empty
const staffCount = db.prepare("SELECT COUNT(*) as count FROM staff").get() as { count: number };
if (staffCount.count === 0) {
  const insertStaff = db.prepare("INSERT INTO staff (name) VALUES (?)");
  const initialStaff = ["Bharath", "Harry", "Arcadia", "Breeana", "Gurleen", "Likitha", "Isis", "Bronson"];
  initialStaff.forEach(name => insertStaff.run(name));
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // --- KPI Tracker API ---
  app.get("/api/staff", (req, res) => {
    const staff = db.prepare("SELECT * FROM staff ORDER BY name ASC").all();
    res.json(staff);
  });

  app.post("/api/staff", (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });
    try {
      const result = db.prepare("INSERT INTO staff (name) VALUES (?)").run(name);
      res.json({ id: result.lastInsertRowid, name });
    } catch (error: any) {
      res.status(400).json({ error: "Staff member already exists" });
    }
  });

  app.delete("/api/staff/:id", (req, res) => {
    try {
      // Check if staff has sales entries or roster entries
      const hasEntries = db.prepare("SELECT COUNT(*) as count FROM sales_entries WHERE staff_id = ?").get(req.params.id) as { count: number };
      const hasRoster = db.prepare("SELECT COUNT(*) as count FROM rosters WHERE staff_id = ?").get(req.params.id) as { count: number };
      
      if (hasEntries.count > 0 || hasRoster.count > 0) {
        return res.status(400).json({ error: "Cannot delete staff with existing sales or roster records" });
      }

      db.prepare("DELETE FROM staff WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/budget/:date", (req, res) => {
    const budget = db.prepare(`
      SELECT 
        date, 
        total_budget, 
        COALESCE(NULLIF(total_hours, 0), (SELECT SUM(shift_hours) FROM rosters WHERE date = ?), 0) as total_hours
      FROM daily_budgets 
      WHERE date = ?
    `).get(req.params.date, req.params.date);
    
    if (budget) {
      res.json(budget);
    } else {
      // If no budget entry, still try to get hours from roster
      const rosterHours = db.prepare("SELECT SUM(shift_hours) as total_hours FROM rosters WHERE date = ?").get(req.params.date) as { total_hours: number | null };
      res.json({ date: req.params.date, total_budget: 0, total_hours: rosterHours.total_hours || 0 });
    }
  });

  app.post("/api/budget", (req, res) => {
    const { date, total_budget, total_hours } = req.body;
    db.prepare(`
      INSERT INTO daily_budgets (date, total_budget, total_hours)
      VALUES (?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        total_budget = excluded.total_budget,
        total_hours = excluded.total_hours
    `).run(date, total_budget, total_hours);
    res.json({ success: true });
  });

  app.post("/api/bulk-budget", (req, res) => {
    const budgets = req.body; // Array of { date, total_budget, total_hours }
    const insert = db.prepare(`
      INSERT INTO daily_budgets (date, total_budget, total_hours)
      VALUES (?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        total_budget = excluded.total_budget,
        total_hours = CASE 
          WHEN excluded.total_hours > 0 THEN excluded.total_hours 
          ELSE daily_budgets.total_hours 
        END
    `);
    
    const transaction = db.transaction((data) => {
      for (const item of data) {
        // Skip invalid dates like 1899-12-31
        if (item.date === '1899-12-31') continue;
        insert.run(item.date, item.total_budget, item.total_hours || 0);
      }
    });
    
    transaction(budgets);
    res.json({ success: true, count: budgets.length });
  });

  app.post("/api/bulk-roster", (req, res) => {
    const rosters = req.body; // Array of { staff_name, date, shift_hours }
    const findStaff = db.prepare("SELECT id FROM staff WHERE name = ?");
    const insertStaff = db.prepare("INSERT INTO staff (name) VALUES (?)");
    const insertRoster = db.prepare(`
      INSERT INTO rosters (staff_id, date, shift_hours)
      VALUES (?, ?, ?)
      ON CONFLICT(staff_id, date) DO UPDATE SET
        shift_hours = excluded.shift_hours
    `);

    const transaction = db.transaction((data) => {
      const datesToUpdate = new Set<string>();
      for (const item of data) {
        // Try exact match first, then partial match
        let staff = findStaff.get(item.staff_name) as { id: number } | undefined;
        
        if (!staff) {
          staff = db.prepare("SELECT id FROM staff WHERE ? LIKE '%' || name || '%'").get(item.staff_name) as { id: number } | undefined;
        }

        // If still not found, create the staff member (using a simplified name)
        if (!staff) {
          const simplifiedName = item.staff_name.split(' ')[0]; // Use first name as default
          try {
            const result = insertStaff.run(item.staff_name);
            staff = { id: Number(result.lastInsertRowid) };
          } catch (e) {
            // If full name exists but didn't match (unlikely), try to find it again
            staff = findStaff.get(item.staff_name) as { id: number } | undefined;
          }
        }

        if (staff) {
          insertRoster.run(staff.id, item.date, item.shift_hours);
          datesToUpdate.add(item.date);
        }
      }

      // Update total_hours in daily_budgets for affected dates
      const updateBudgetHours = db.prepare(`
        INSERT INTO daily_budgets (date, total_budget, total_hours)
        VALUES (?, 0, COALESCE((SELECT SUM(shift_hours) FROM rosters WHERE date = ?), 0))
        ON CONFLICT(date) DO UPDATE SET
          total_hours = COALESCE((SELECT SUM(shift_hours) FROM rosters WHERE date = ?), 0)
      `);

      for (const date of datesToUpdate) {
        updateBudgetHours.run(date, date, date);
      }
    });

    transaction(rosters);
    res.json({ success: true, count: rosters.length });
  });

  app.get("/api/sales/:date", (req, res) => {
    const sales = db.prepare(`
      SELECT 
        st.id as staff_id, 
        st.name, 
        COALESCE(s.shift_hours, r.shift_hours, 0) as shift_hours, 
        COALESCE(s.actual_sales, 0) as actual_sales, 
        COALESCE(s.target_sales, 0) as target_sales,
        COALESCE(s.ips, 0) as ips,
        COALESCE(s.avg_sale, 0) as avg_sale,
        COALESCE(s.jcp_sales, 0) as jcp_sales,
        CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END as is_submitted
      FROM staff st
      LEFT JOIN rosters r ON st.id = r.staff_id AND r.date = ?
      LEFT JOIN sales_entries s ON st.id = s.staff_id AND s.date = ?
      ORDER BY st.name ASC
    `).all(req.params.date, req.params.date);
    res.json(sales);
  });

  app.get("/api/monthly-summary/:year/:month", (req, res) => {
    const { year, month } = req.params;
    const firstDay = `${year}-${month.padStart(2, '0')}-01`;
    const lastDay = format(endOfMonth(new Date(parseInt(year), parseInt(month) - 1)), 'yyyy-MM-dd');
    const datePattern = `${year}-${month.padStart(2, '0')}-%`;
    
    const summary = db.prepare(`
      SELECT 
        st.id as staff_id,
        st.name,
        COALESCE(SUM(s.actual_sales), 0) as total_sales,
        COALESCE(SUM(s.target_sales), 0) as total_target,
        COALESCE(SUM(COALESCE(s.shift_hours, r.shift_hours)), 0) as total_hours,
        COALESCE(AVG(CASE WHEN s.ips > 0 THEN s.ips END), 0) as avg_ips,
        COALESCE(AVG(CASE WHEN s.avg_sale > 0 THEN s.avg_sale END), 0) as avg_sale_val
      FROM staff st
      LEFT JOIN rosters r ON st.id = r.staff_id AND r.date LIKE ?
      LEFT JOIN sales_entries s ON st.id = s.staff_id AND s.date LIKE ?
      GROUP BY st.id
      ORDER BY st.name ASC
    `).all(datePattern, datePattern);
    
    const storeBudget = db.prepare(`
      WITH RECURSIVE dates(date) AS (
        VALUES(?)
        UNION ALL
        SELECT date(date, '+1 day')
        FROM dates
        WHERE date <= ?
      )
      SELECT 
        COALESCE(SUM(b.total_budget), 0) as total_budget,
        COALESCE(SUM(COALESCE(NULLIF(b.total_hours, 0), (SELECT SUM(shift_hours) FROM rosters WHERE date = d.date), 0)), 0) as total_hours
      FROM dates d
      LEFT JOIN daily_budgets b ON d.date = b.date
    `).get(firstDay, lastDay);

    const dailyBudgets = db.prepare(`
      WITH RECURSIVE dates(date) AS (
        VALUES(?)
        UNION ALL
        SELECT date(date, '+1 day')
        FROM dates
        WHERE date <= ?
      )
      SELECT 
        d.date, 
        COALESCE(b.total_budget, 0) as total_budget, 
        COALESCE(NULLIF(b.total_hours, 0), (SELECT SUM(shift_hours) FROM rosters WHERE date = d.date), 0) as total_hours
      FROM dates d
      LEFT JOIN daily_budgets b ON d.date = b.date
    `).all(firstDay, lastDay);

    res.json({ staff: summary, store: storeBudget, dailyBudgets });
  });

  app.post("/api/sales", (req, res) => {
    const { staff_id, date, shift_hours, actual_sales, target_sales, ips, avg_sale, jcp_sales } = req.body;
    try {
      db.prepare(`
        INSERT INTO sales_entries (staff_id, date, shift_hours, actual_sales, target_sales, ips, avg_sale, jcp_sales)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(staff_id, date) DO UPDATE SET
          shift_hours = excluded.shift_hours,
          actual_sales = excluded.actual_sales,
          target_sales = excluded.target_sales,
          ips = excluded.ips,
          avg_sale = excluded.avg_sale,
          jcp_sales = excluded.jcp_sales
      `).run(staff_id, date, shift_hours, actual_sales, target_sales, ips || 0, avg_sale || 0, jcp_sales || 0);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/monthly-details/:year/:month", (req, res) => {
    const { year, month } = req.params;
    const firstDay = `${year}-${month.padStart(2, '0')}-01`;
    const lastDay = format(endOfMonth(new Date(parseInt(year), parseInt(month) - 1)), 'yyyy-MM-dd');
    
    const details = db.prepare(`
      WITH RECURSIVE dates(date) AS (
        VALUES(?)
        UNION ALL
        SELECT date(date, '+1 day')
        FROM dates
        WHERE date <= ?
      )
      SELECT 
        st.id as staff_id,
        d.date,
        COALESCE(s.actual_sales, 0) as actual_sales,
        COALESCE(s.target_sales, 0) as target_sales,
        COALESCE(s.shift_hours, r.shift_hours, 0) as shift_hours,
        COALESCE(s.ips, 0) as ips,
        COALESCE(s.avg_sale, 0) as avg_sale,
        COALESCE(s.jcp_sales, 0) as jcp_sales
      FROM staff st
      CROSS JOIN dates d
      LEFT JOIN rosters r ON st.id = r.staff_id AND r.date = d.date
      LEFT JOIN sales_entries s ON st.id = s.staff_id AND s.date = d.date
      ORDER BY d.date ASC
    `).all(firstDay, lastDay);
    
    res.json(details);
  });

  app.delete("/api/clear-month/:year/:month", (req, res) => {
    const { year, month } = req.params;
    const datePattern = `${year}-${month.padStart(2, '0')}-%`;
    
    try {
      const transaction = db.transaction(() => {
        db.prepare("DELETE FROM sales_entries WHERE date LIKE ?").run(datePattern);
        db.prepare("DELETE FROM rosters WHERE date LIKE ?").run(datePattern);
        db.prepare("DELETE FROM daily_budgets WHERE date LIKE ?").run(datePattern);
      });
      transaction();
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- Repair Tracker API ---
  app.get("/api/repairs", (req, res) => {
    const repairs = db.prepare("SELECT * FROM repairs ORDER BY date_due_back ASC").all();
    res.json(repairs);
  });

  app.post("/api/repairs", (req, res) => {
    const { customer_name, customer_phone, customer_email, item_description, repair_category, condition_notes, risk_warnings, is_quoted, quoted_price, date_received, date_sent, date_due_back, jeweller, status, customer_contacted, comms_notes } = req.body;
    const result = db.prepare(`
      INSERT INTO repairs (customer_name, customer_phone, customer_email, item_description, repair_category, condition_notes, risk_warnings, is_quoted, quoted_price, date_received, date_sent, date_due_back, jeweller, status, customer_contacted, comms_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(customer_name, customer_phone, customer_email, item_description, repair_category, condition_notes, risk_warnings, is_quoted ? 1 : 0, quoted_price, date_received, date_sent, date_due_back, jeweller, status, customer_contacted ? 1 : 0, comms_notes);
    res.json({ id: result.lastInsertRowid });
  });

  app.put("/api/repairs/:id", (req, res) => {
    const { customer_name, customer_phone, customer_email, item_description, repair_category, condition_notes, risk_warnings, is_quoted, quoted_price, date_received, date_sent, date_due_back, jeweller, status, customer_contacted, comms_notes } = req.body;
    db.prepare(`
      UPDATE repairs SET
        customer_name = ?, customer_phone = ?, customer_email = ?, item_description = ?, repair_category = ?, condition_notes = ?, risk_warnings = ?, is_quoted = ?, quoted_price = ?, date_received = ?, date_sent = ?, date_due_back = ?, jeweller = ?, status = ?, customer_contacted = ?, comms_notes = ?
      WHERE id = ?
    `).run(customer_name, customer_phone, customer_email, item_description, repair_category, condition_notes, risk_warnings, is_quoted ? 1 : 0, quoted_price, date_received, date_sent, date_due_back, jeweller, status, customer_contacted ? 1 : 0, comms_notes, req.params.id);
    res.json({ success: true });
  });

  app.delete("/api/repairs/:id", (req, res) => {
    db.prepare("DELETE FROM repairs WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // --- Quote Tracker API ---
  app.get("/api/quotes", (req, res) => {
    const quotes = db.prepare("SELECT * FROM quotes ORDER BY inquiry_date DESC").all();
    res.json(quotes);
  });

  app.post("/api/quotes", (req, res) => {
    const { customer_name, inquiry_date, contact_phone, contact_email, contact_method, price_to_begin, date_of_quote, quote_info, quoted_price, customer_contacted, status, approved_date } = req.body;
    const result = db.prepare(`
      INSERT INTO quotes (customer_name, inquiry_date, contact_phone, contact_email, contact_method, price_to_begin, date_of_quote, quote_info, quoted_price, customer_contacted, status, approved_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(customer_name, inquiry_date, contact_phone, contact_email, contact_method, price_to_begin, date_of_quote, quote_info, quoted_price, customer_contacted ? 1 : 0, status, approved_date);
    res.json({ id: result.lastInsertRowid });
  });

  app.put("/api/quotes/:id", (req, res) => {
    const { customer_name, inquiry_date, contact_phone, contact_email, contact_method, price_to_begin, date_of_quote, quote_info, quoted_price, customer_contacted, status, approved_date } = req.body;
    db.prepare(`
      UPDATE quotes SET
        customer_name = ?, inquiry_date = ?, contact_phone = ?, contact_email = ?, contact_method = ?, price_to_begin = ?, date_of_quote = ?, quote_info = ?, quoted_price = ?, customer_contacted = ?, status = ?, approved_date = ?
      WHERE id = ?
    `).run(customer_name, inquiry_date, contact_phone, contact_email, contact_method, price_to_begin, date_of_quote, quote_info, quoted_price, customer_contacted ? 1 : 0, status, approved_date, req.params.id);
    res.json({ success: true });
  });

  app.post("/api/quotes/:id/convert", (req, res) => {
    const quoteId = req.params.id;
    const quote = db.prepare("SELECT * FROM quotes WHERE id = ?").get(quoteId) as any;
    if (!quote) return res.status(404).json({ error: "Quote not found" });

    const { date_ordered, date_estimated } = req.body;

    const transaction = db.transaction(() => {
      // Create Special Order
      const result = db.prepare(`
        INSERT INTO special_orders (source_quote_id, customer_name, customer_phone, customer_email, item_description, date_ordered, date_estimated, status, comms_log)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'Ordered', ?)
      `).run(quoteId, quote.customer_name, quote.contact_phone, quote.contact_email, quote.quote_info, date_ordered, date_estimated, `Converted from Quote ${quoteId} on ${date_ordered}`);

      // Update Quote Status
      db.prepare("UPDATE quotes SET status = 'Accepted', approved_date = ? WHERE id = ?").run(date_ordered, quoteId);

      return result.lastInsertRowid;
    });

    const orderId = transaction();
    res.json({ success: true, orderId });
  });

  // --- Special Order Tracker API ---
  app.get("/api/special-orders", (req, res) => {
    const orders = db.prepare("SELECT * FROM special_orders ORDER BY date_estimated ASC").all();
    res.json(orders);
  });

  app.post("/api/special-orders", (req, res) => {
    const { source_quote_id, customer_name, customer_phone, customer_email, item_description, stone_lab_nat, stone_shape, stone_carat, stone_colour, stone_clarity, stone_report_no, stone_measurements, date_ordered, date_estimated, date_actual_ready, date_collected, status, comms_log } = req.body;
    const result = db.prepare(`
      INSERT INTO special_orders (source_quote_id, customer_name, customer_phone, customer_email, item_description, stone_lab_nat, stone_shape, stone_carat, stone_colour, stone_clarity, stone_report_no, stone_measurements, date_ordered, date_estimated, date_actual_ready, date_collected, status, comms_log)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(source_quote_id, customer_name, customer_phone, customer_email, item_description, stone_lab_nat, stone_shape, stone_carat, stone_colour, stone_clarity, stone_report_no, stone_measurements, date_ordered, date_estimated, date_actual_ready, date_collected, status, comms_log);
    res.json({ id: result.lastInsertRowid });
  });

  app.put("/api/special-orders/:id", (req, res) => {
    const { source_quote_id, customer_name, customer_phone, customer_email, item_description, stone_lab_nat, stone_shape, stone_carat, stone_colour, stone_clarity, stone_report_no, stone_measurements, date_ordered, date_estimated, date_actual_ready, date_collected, status, comms_log } = req.body;
    db.prepare(`
      UPDATE special_orders SET
        source_quote_id = ?, customer_name = ?, customer_phone = ?, customer_email = ?, item_description = ?, stone_lab_nat = ?, stone_shape = ?, stone_carat = ?, stone_colour = ?, stone_clarity = ?, stone_report_no = ?, stone_measurements = ?, date_ordered = ?, date_estimated = ?, date_actual_ready = ?, date_collected = ?, status = ?, comms_log = ?
      WHERE id = ?
    `).run(source_quote_id, customer_name, customer_phone, customer_email, item_description, stone_lab_nat, stone_shape, stone_carat, stone_colour, stone_clarity, stone_report_no, stone_measurements, date_ordered, date_estimated, date_actual_ready, date_collected, status, comms_log, req.params.id);
    res.json({ success: true });
  });

  app.delete("/api/special-orders/:id", (req, res) => {
    db.prepare("DELETE FROM special_orders WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

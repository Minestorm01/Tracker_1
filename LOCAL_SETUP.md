# KPI Tracker - Local Setup Guide

This application is built with React (Vite) and an Express backend using SQLite for local data storage. You can easily run this locally on your own machine or within a VirtualBox environment.

## Prerequisites

Before you begin, ensure you have the following installed on your VirtualBox OS (Ubuntu/Debian recommended, but works on Windows/macOS):

1. **Node.js**: Version 18 or higher.
   - Download from [nodejs.org](https://nodejs.org/) or use a package manager like `nvm`.
2. **Git** (optional, but recommended for cloning the code).

## Installation

1. **Get the Code**:
   - Download the source code files to a directory on your VirtualBox machine.
   - Ensure you have all the files, including `package.json`, `server.ts`, `vite.config.ts`, and the `src` folder.

2. **Install Dependencies**:
   - Open your terminal or command prompt.
   - Navigate to the directory where you saved the code.
   - Run the following command to install all required packages:
     ```bash
     npm install
     ```

## Running the Application

There are two ways to run the application: Development mode and Production mode.

### Option 1: Development Mode (Recommended for testing)

This mode runs the server and the frontend with hot-reloading.

```bash
npm run dev
```

The application will start, and you can access it in your web browser at:
`http://localhost:3000`

### Option 2: Production Mode

This mode builds the frontend into static files and serves them via the Express backend. This is closer to how a deployed app runs.

1. Build the frontend:
   ```bash
   npm run build
   ```
2. Start the production server:
   ```bash
   npm start
   ```
   *(Note: You may need to add `"start": "node --experimental-specifier-resolution=node --loader ts-node/esm server.ts"` to your package.json scripts, or compile `server.ts` to JavaScript first depending on your Node version. The easiest way is to use `npx tsx server.ts`)*

## Data Storage

All your data (staff, budgets, rosters, sales entries) is saved locally in a SQLite database file named `kpi_tracker.db`.

- **Location**: This file is automatically created in the root directory of your project the first time you run the server.
- **Backups**: To back up your data, simply copy the `kpi_tracker.db` file to a safe location.
- **Resetting**: If you ever want to completely wipe all data and start fresh, you can delete the `kpi_tracker.db` file while the server is stopped. It will be recreated empty the next time you start the server.

## Network Access (Accessing from Host Machine)

If you are running this inside VirtualBox and want to access it from your main host computer:

1. Ensure your VirtualBox Network Adapter is set to **Bridged Adapter** or **NAT with Port Forwarding** (forwarding host port 3000 to guest port 3000).
2. Find the IP address of your VirtualBox guest OS (e.g., `192.168.1.X`).
3. The server is configured to listen on `0.0.0.0`, meaning it accepts connections from the network.
4. On your host computer, open a browser and navigate to `http://<VIRTUALBOX_IP>:3000`.

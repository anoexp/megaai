const fs = require('fs');
const axios = require('axios');

const colors = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  white: "\x1b[37m",
  bold: "\x1b[1m"
};

const logger = {
  info: (msg) => console.log(`${colors.green}[✓] ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}[⚠] ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}[✗] ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}[✅] ${msg}${colors.reset}`),
  loading: (msg) => console.log(`${colors.cyan}[⟳] ${msg}${colors.reset}`),
  step: (msg) => console.log(`${colors.white}[➤] ${msg}${colors.reset}`),
  banner: () => {
    console.log(`${colors.cyan}${colors.bold}`);
    console.log(`---------------------------------------------`);
    console.log(`  MEGA AI Testnet Auto Bot - Airdrop Insiders  `);
    console.log(`---------------------------------------------${colors.reset}`);
    console.log();
  }
};

class MegaAIBot {
  constructor() {
    this.baseURL = 'https://api-dev.megai.city';
    this.token = '';
    this.headers = {
      'accept': 'application/json, text/plain, */*',
      'accept-language': 'en-US,en;q=0.7',
      'content-type': 'application/json',
      'priority': 'u=1, i',
      'sec-ch-ua': '"Brave";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
      'sec-gpc': '1',
      'Referer': 'https://game-test.megai.city/',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    };
    
    this.rawMaterials = [];
    this.npcs = [];
    this.itemNames = {};
    this.roomIds = Array.from({length: 12}, (_, i) => i + 1);
    this.missions = [];
    this.missionCache = new Map();
    this.energy = 0;
    this.maxEnergy = 1500;
    this.minEnergyThreshold = 25;
    this.isRunning = false;
    this.cycleCount = 0;
    this.maxRetries = 3;
  }

  loadToken() {
    try {
      this.token = fs.readFileSync('token.txt', 'utf8').trim();
      this.headers.authorization = `Bearer ${this.token}`;
      logger.info('Token loaded successfully');
      return true;
    } catch (error) {
      logger.error('Failed to load token from token.txt');
      logger.error(error.message);
      return false;
    }
  }

  async getEnergyStatus() {
    try {
      logger.loading('Fetching energy status...');
      const response = await axios.get(`${this.baseURL}/game/get-energy`, {
        headers: {
          ...this.headers,
          'if-none-match': 'W/"59-jlfG3NNgsUWZNy724Beq5C0Fkkg"'
        },
        validateStatus: status => status === 200 || status === 304
      });

      if (response.status === 304) {
        logger.info('Energy status unchanged, using cached values');
        return { energy: this.energy, max_energy: this.maxEnergy };
      }

      if (response.data.error_code === 'OK') {
        this.energy = response.data.data.energy;
        this.maxEnergy = response.data.data.max_energy;
        logger.info(`Energy: ${this.energy}/${this.maxEnergy}`);
        return response.data.data;
      } else {
        logger.warn(`Failed to fetch energy: ${response.data.error_code}`);
        return null;
      }
    } catch (error) {
      logger.error(`Error fetching energy: ${error.message}`);
      return null;
    }
  }

  async collectItem(itemId, roomId, attempt = 1) {
    try {
      const response = await axios.post(`${this.baseURL}/game/collect-item`, {
        item_id: itemId,
        room_id: roomId
      }, {
        headers: this.headers
      });

      if (response.data.error_code === 'OK' && response.data.data === true) {
        this.energy -= this.minEnergyThreshold;
        return true;
      }
      logger.warn(`Failed to collect item ${itemId} in room ${roomId}: ${response.data.error_code || 'Unknown error'}`);
      return false;
    } catch (error) {
      if (attempt < this.maxRetries) {
        logger.warn(`Retrying collection for item ${itemId} in room ${roomId} (attempt ${attempt + 1}/${this.maxRetries})`);
        await this.delay(500);
        return this.collectItem(itemId, roomId, attempt + 1);
      }
      logger.error(`Error collecting item ${itemId} in room ${roomId} after ${attempt} attempts: ${error.message}`);
      return false;
    }
  }

  async tryCollectItemFromAllRooms(itemId, itemName) {
    logger.loading(`Attempting to collect ${itemName} (ID: ${itemId}) from all rooms...`);
    let successCount = 0;

    for (const roomId of this.roomIds) {
      if (this.energy < this.minEnergyThreshold) {
        logger.warn(`Insufficient energy (${this.energy}/${this.maxEnergy}) to collect ${itemName} in room ${roomId}`);
        break;
      }

      logger.step(`Trying ${itemName} in room ${roomId}...`);
      const success = await this.collectItem(itemId, roomId);
      if (success) {
        logger.success(`✅ Collected ${itemName} from room ${roomId}`);
        successCount++;
      } else {
        logger.warn(`❌ Failed to collect ${itemName} from room ${roomId}`);
      }

      await this.delay(100);
    }

    if (successCount > 0) {
      logger.info(`${itemName}: Collected ${successCount} times from different rooms`);
    } else {
      logger.warn(`${itemName}: Not collected from any room`);
    }

    return successCount;
  }

  async getAllItems() {
    try {
      logger.loading('Fetching all available raw materials (Type 1)...');
      const rawMaterialsResponse = await axios.get(`${this.baseURL}/game/items?type=1`, {
        headers: this.headers
      });

      logger.loading('Fetching all available NPCs (Type 2)...');
      const npcsResponse = await axios.get(`${this.baseURL}/game/items?type=2`, {
        headers: this.headers
      });

      if (rawMaterialsResponse.data.error_code === 'OK' && npcsResponse.data.error_code === 'OK') {
        const rawMaterials = rawMaterialsResponse.data.data.data;
        const npcs = npcsResponse.data.data.data;
        
        this.rawMaterials = rawMaterials.map(item => item.id);
        this.npcs = npcs.map(item => item.id);
        
        this.itemNames = {};
        [...rawMaterials, ...npcs].forEach(item => {
          this.itemNames[item.id] = item.name;
        });
        
        logger.info(`Found ${rawMaterials.length} raw materials and ${npcs.length} NPCs`);
        
        logger.step('=== RAW MATERIALS (Type 1) ===');
        rawMaterials.forEach(item => {
          logger.step(`ID: ${item.id} - ${item.name}`);
        });
        
        logger.step('=== NPCs (Type 2) ===');
        npcs.forEach(item => {
          logger.step(`ID: ${item.id} - ${item.name}`);
        });
        
        return { rawMaterials, npcs };
      } else {
        logger.error('Failed to get items list');
        return { rawMaterials: [], npcs: [] };
      }
    } catch (error) {
      logger.error(`Error getting items: ${error.message}`);
      return { rawMaterials: [], npcs: [] };
    }
  }

  async getAllMissions() {
    try {
      logger.loading('Fetching all active missions...');
      
      const missionIds = [780, 790];
      const missions = [];
      
      for (const missionId of missionIds) {
        try {
          const headers = { ...this.headers };
          if (this.missionCache.has(missionId)) {
            headers['if-none-match'] = this.missionCache.get(missionId).etag;
          }
          
          const response = await axios.get(`${this.baseURL}/game/mission/show-progress`, {
            headers,
            validateStatus: status => status === 200 || status === 304
          });
          
          if (response.status === 304) {
            const cached = this.missionCache.get(missionId);
            if (cached && cached.data) {
              missions.push(cached.data);
              logger.info(`Using cached data for mission ${missionId} (no changes)`);
            }
            continue;
          }
          
          if (response.data.error_code === 'OK') {
            const missionData = response.data.data;
            missions.push(missionData);
            this.missionCache.set(missionId, {
              data: missionData,
              etag: response.headers['etag'] || ''
            });
          } else {
            logger.warn(`Failed to fetch mission ${missionId}: ${response.data.error_code}`);
          }
        } catch (error) {
          logger.error(`Error fetching mission ${missionId}: ${error.message}`);
        }
      }
      
      if (missions.length === 0 && this.missionCache.size > 0) {
        missions.push(...Array.from(this.missionCache.values()).map(entry => entry.data));
      }
      
      this.missions = missions;
      
      if (missions.length > 0) {
        logger.info(`Found ${missions.length} active missions`);
        missions.forEach(mission => {
          logger.step(`Mission ID: ${mission.missionId} - ${mission.description}`);
          logger.step(`Progress: ${mission.overallProgress.text} (${mission.overallProgress.met}/${mission.overallProgress.total})`);
          mission.requirements.forEach(req => {
            logger.step(`  - ${req.itemName}: ${req.progressText} ${req.isMet ? '(Met)' : ''}`);
          });
        });
      } else {
        logger.warn('No active missions found or all requests failed.');
      }
      
      return missions;
    } catch (error) {
      logger.error(`Error fetching missions: ${error.message}`);
      return Array.from(this.missionCache.values()).map(entry => entry.data);
    }
  }

  async completeMission(missionId) {
    try {
      const response = await axios.post(`${this.baseURL}/game/mission/complete`, {
        mission_id: missionId
      }, {
        headers: this.headers
      });

      if (response.data.error_code === 'OK') {
        logger.success(`Mission ${missionId} completed successfully!`);
        this.missionCache.delete(missionId);
        return true;
      } else {
        logger.warn(`Failed to complete mission ${missionId}: ${response.data.error_code}`);
        return false;
      }
    } catch (error) {
      logger.error(`Error completing mission ${missionId}: ${error.message}`);
      return false;
    }
  }

  async runCollectionCycle() {
    const energyStatus = await this.getEnergyStatus();
    if (!energyStatus || this.energy < this.minEnergyThreshold) {
      logger.error(`Insufficient energy (${this.energy}/${this.maxEnergy}) to start collection cycle`);
      return 0;
    }

    logger.step(`Starting collection cycle for ${this.rawMaterials.length} raw material items across ${this.roomIds.length} rooms...`);
    
    let cycleCollected = 0;
    
    for (const itemId of this.rawMaterials) {
      const itemName = this.itemNames[itemId] || `Item ${itemId}`;
      
      if (this.energy < this.minEnergyThreshold) {
        logger.warn(`Insufficient energy (${this.energy}/${this.maxEnergy}) to continue collecting`);
        break;
      }
      
      const collected = await this.tryCollectItemFromAllRooms(itemId, itemName);
      cycleCollected += collected;

      await this.getAllMissions();
      
      await this.delay(300);
    }
    
    logger.info(`Collection cycle completed. Total items collected: ${cycleCollected}`);
    return cycleCollected;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async run() {
    logger.banner();
    
    if (!this.loadToken()) {
      return;
    }

    try {
      const { rawMaterials, npcs } = await this.getAllItems();
      if (this.rawMaterials.length === 0) {
        logger.error('No raw materials found. Exiting...');
        return;
      }

      await this.getEnergyStatus();
      await this.getAllMissions();

      if (this.missions.length === 0 && this.missionCache.size === 0) {
        logger.error('No active missions found and no cached data. Exiting...');
        return;
      }

      logger.step('Starting continuous collection loop...');
      logger.info('Press Ctrl+C to stop the bot');
      
      this.isRunning = true;
      
      process.on('SIGINT', () => {
        logger.warn('Received interrupt signal. Stopping bot...');
        this.isRunning = false;
      });

      while (this.isRunning) {
        this.cycleCount++;
        
        logger.step(`${colors.cyan}========== CYCLE ${this.cycleCount} START ==========${colors.reset}`);
        
        const collected = await this.runCollectionCycle();
        
        const missions = await this.getAllMissions();
        
        for (const mission of missions) {
          if (mission.canCompleteNow) {
            await this.completeMission(mission.missionId);
          }
        }
        
        logger.step(`${colors.cyan}========== CYCLE ${this.cycleCount} COMPLETE ==========${colors.reset}`);
        logger.info(`Items collected this cycle: ${collected}`);
        
        if (this.isRunning && collected === 0 && this.energy < this.minEnergyThreshold) {
          logger.loading('Energy depleted. Waiting 5 minutes for energy regeneration...');
          for (let i = 300; i > 0 && this.isRunning; i--) {
            process.stdout.write(`\r${colors.yellow}[⏳] Next cycle in: ${i}s ${colors.reset}`);
            await this.delay(1000);
          }
          console.log();
        } else if (this.isRunning) {
          logger.loading('Waiting 1 minute before next cycle...');
          for (let i = 60; i > 0 && this.isRunning; i--) {
            process.stdout.write(`\r${colors.yellow}[⏳] Next cycle in: ${i}s ${colors.reset}`);
            await this.delay(1000);
          }
          console.log();
        }
      }
      
      logger.success('Bot stopped gracefully.');

    } catch (error) {
      logger.error(`Bot execution failed: ${error.message}`);
    }
  }

  stop() {
    this.isRunning = false;
    logger.warn('Bot stopping...');
  }
}

if (require.main === module) {
  const bot = new MegaAIBot();
  bot.run().catch(console.error);
}

module.exports = MegaAIBot;

import { PipelineItem, GeneratedImage, Post, ActivityLog, SavedResearch, PipelineStatus } from '../lib/store';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const getDb = () => {
  const db = localStorage.getItem('radix_mock_db');
  if (db) return JSON.parse(db);
  
  // Default seed data
  return {
    pipelineItems: [
      { 
        id: '1', title: 'Summer Campaign Teaser', platform: 'Instagram', 
        description: 'Teaser video for the upcoming summer collection.',
        priority: 'high', dueDate: new Date(Date.now() + 86400000 * 2).toISOString(), 
        assignee: 'Sarah J.', status: 'draft', comments: [] 
      },
      { 
        id: '2', title: 'Weekly Market Update', platform: 'Twitter', 
        description: 'Thread about this week\'s market trends.',
        priority: 'medium', dueDate: new Date(Date.now() + 86400000 * 3).toISOString(), 
        assignee: 'Elena R.', status: 'in-review', comments: [] 
      }
    ],
    generatedImages: [],
    posts: [],
    activityLogs: [
      { id: 'a1', action: 'Generated Q2 Social Media Calendar', time: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), type: 'calendar' },
      { id: 'a2', action: 'Created 4 images for Summer Campaign', time: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(), type: 'image' },
    ],
    savedResearch: []
  };
};

const saveDb = (db: any) => {
  localStorage.setItem('radix_mock_db', JSON.stringify(db));
};

export const mockApi = {
  async fetchAll() {
    await delay(500);
    return getDb();
  },
  async addPipelineItem(item: PipelineItem) {
    await delay(300);
    const db = getDb();
    db.pipelineItems.push(item);
    saveDb(db);
    return item;
  },
  async updatePipelineItemStatus(id: string, status: PipelineStatus) {
    await delay(300);
    const db = getDb();
    const item = db.pipelineItems.find((i: any) => i.id === id);
    if (item) item.status = status;
    saveDb(db);
  },
  async addComment(itemId: string, comment: any) {
    await delay(300);
    const db = getDb();
    const item = db.pipelineItems.find((i: any) => i.id === itemId);
    if (item) item.comments.push(comment);
    saveDb(db);
  },
  async addGeneratedImage(image: GeneratedImage) {
    await delay(300);
    const db = getDb();
    db.generatedImages.unshift(image);
    db.generatedImages = db.generatedImages.slice(0, 50);
    saveDb(db);
  },
  async setPosts(posts: Post[]) {
    await delay(300);
    const db = getDb();
    db.posts = posts;
    saveDb(db);
  },
  async logActivity(log: ActivityLog) {
    await delay(200);
    const db = getDb();
    db.activityLogs.unshift(log);
    db.activityLogs = db.activityLogs.slice(0, 20);
    saveDb(db);
  }
};

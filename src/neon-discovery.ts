import { createApiClient } from '@neondatabase/api-client';

export interface NeonProject {
  id: string;
  name: string;
  region_id: string;
  created_at: string;
  updated_at: string;
}

export interface NeonBranch {
  id: string;
  name: string;
  project_id: string;
  created_at: string;
  updated_at: string;
  primary: boolean;
  default: boolean;
}

export interface DatabaseActivity {
  project_id: string;
  project_name: string;
  branch_id: string;
  branch_name: string;
  has_recent_activity: boolean;
  last_activity_date?: string;
  connection_uri?: string;
}

export class NeonDiscoveryService {
  private apiClient;
  private retentionDays: number;

  constructor(apiKey: string, retentionDays: number = 7) {
    this.apiClient = createApiClient({ apiKey });
    this.retentionDays = retentionDays;
  }

  /**
   * Discover all projects in the Neon account
   */
  async discoverProjects(): Promise<NeonProject[]> {
    try {
      console.log('🔍 Discovering Neon projects...');
      const response = await this.apiClient.listProjects({});
      const projects = response.data.projects.map(project => ({
        id: project.id,
        name: project.name,
        region_id: project.region_id,
        created_at: project.created_at,
        updated_at: project.updated_at
      }));
      
      console.log(`✅ Found ${projects.length} projects`);
      return projects;
    } catch (error) {
      console.error('❌ Error discovering projects:', error);
      throw error;
    }
  }

  /**
   * Discover all branches for a given project
   */
  async discoverBranches(projectId: string): Promise<NeonBranch[]> {
    try {
      console.log(`🔍 Discovering branches for project ${projectId}...`);
      const response = await this.apiClient.listProjectBranches({ projectId });
      const branches = response.data.branches.map(branch => ({
        id: branch.id,
        name: branch.name,
        project_id: projectId,
        created_at: branch.created_at,
        updated_at: branch.updated_at,
        primary: branch.primary || false,
        default: branch.default || false
      }));
      
      console.log(`✅ Found ${branches.length} branches for project ${projectId}`);
      return branches;
    } catch (error) {
      console.error(`❌ Error discovering branches for project ${projectId}:`, error);
      throw error;
    }
  }

  /**
   * Check if a branch has recent activity based on updated_at timestamp
   */
  checkBranchActivity(branch: NeonBranch): boolean {
    try {
      const cutoffDate = new Date();
      cutoffDate.setHours(cutoffDate.getHours() - 23);

      const branchUpdatedAt = new Date(branch.updated_at);
      const hasRecentActivity = branchUpdatedAt >= cutoffDate;

      console.log(
        `📊 Branch ${branch.name} last updated: ${branch.updated_at} - ${hasRecentActivity ? "Active" : "Inactive"}`
      );
      return hasRecentActivity;
    } catch (error) {
      console.error(
        `❌ Error checking activity for branch ${branch.name}:`,
        error
      );
      // If we can't parse the date, assume there's activity to be safe
      return true;
    }
  }

  /**
   * Get connection URI for a branch with automatic role detection
   */
  async getBranchConnectionUri(projectId: string, branchId: string, databaseName: string = 'neondb'): Promise<string> {
    try {
      // First, get available roles for the branch
      const rolesResponse = await this.apiClient.listProjectBranchRoles(projectId, branchId);
      const roles = rolesResponse.data.roles;
      
      if (roles.length === 0) {
        throw new Error(`No roles found for branch ${branchId}`);
      }
      
      // Use the first available role (typically the owner role)
      const roleName = roles[0].name;
      console.log(`🔑 Using role '${roleName}' for branch ${branchId}`);
      
      // Get databases for the branch to find the correct database name
      const dbResponse = await this.apiClient.listProjectBranchDatabases(projectId, branchId);
      const databases = dbResponse.data.databases;
      
      // Use the provided database name if it exists, otherwise use the first available database
      let actualDatabaseName = databaseName;
      if (databases.length > 0) {
        const dbExists = databases.some(db => db.name === databaseName);
        if (!dbExists) {
          actualDatabaseName = databases[0].name;
          console.log(`📊 Database '${databaseName}' not found, using '${actualDatabaseName}' instead`);
        }
      }
      
      const response = await this.apiClient.getConnectionUri({
        projectId: projectId,
        database_name: actualDatabaseName,
        branch_id: branchId,
        role_name: roleName
      });
      
      return response.data.uri;
    } catch (error) {
      console.error(`❌ Error getting connection URI for branch ${branchId}:`, error);
      throw error;
    }
  }

  /**
   * Discover all projects and branches with recent activity
   */
  async discoverActiveResources(): Promise<DatabaseActivity[]> {
    console.log('🚀 Starting discovery of active Neon resources...');
    const activeResources: DatabaseActivity[] = [];

    try {
      // Discover all projects
      const projects = await this.discoverProjects();

      for (const project of projects) {
        console.log(`\n📁 Processing project: ${project.name} (${project.id})`);
        
        try {
          // Discover branches for this project
          const branches = await this.discoverBranches(project.id);

          for (const branch of branches) {
            console.log(`\n🌿 Checking branch: ${branch.name} (${branch.id})`);
            
            try {
              // Check for recent activity using branch updated_at timestamp
              const hasRecentActivity = this.checkBranchActivity(branch);
              
              if (hasRecentActivity) {
                // Get connection URI for backup
                const connectionUri = await this.getBranchConnectionUri(project.id, branch.id);
                
                activeResources.push({
                  project_id: project.id,
                  project_name: project.name,
                  branch_id: branch.id,
                  branch_name: branch.name,
                  has_recent_activity: true,
                  last_activity_date: branch.updated_at,
                  connection_uri: connectionUri
                });

                console.log(`✅ Branch ${branch.name} has recent activity - will be backed up`);
              } else {
                console.log(`⏭️  Branch ${branch.name} has no recent activity - skipping`);
              }
            } catch (error) {
              console.error(`⚠️  Error processing branch ${branch.name}:`, error);
              // Add to backup list anyway if we can't determine activity
              try {
                const connectionUri = await this.getBranchConnectionUri(project.id, branch.id);
                activeResources.push({
                  project_id: project.id,
                  project_name: project.name,
                  branch_id: branch.id,
                  branch_name: branch.name,
                  has_recent_activity: true, // Assume active if we can't check
                  last_activity_date: branch.updated_at,
                  connection_uri: connectionUri
                });
              } catch (uriError) {
                console.error(`❌ Could not get connection URI for branch ${branch.name}:`, uriError);
              }
            }
          }
        } catch (error) {
          console.error(`❌ Error processing project ${project.name}:`, error);
          continue;
        }
      }

      console.log(`\n🎯 Discovery complete! Found ${activeResources.length} resources with recent activity`);
      return activeResources;

    } catch (error) {
      console.error('❌ Error during resource discovery:', error);
      throw error;
    }
  }
}
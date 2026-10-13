import { Component, inject, signal } from '@angular/core';
import { GOD_NODE_ID, isArtifactData } from '../../core/models/graph.model';
import { GraphService } from '../../core/services/graph.service';
import { RepoGitService } from '../../core/services/repo-git.service';
import { SecretsService } from '../../core/services/secrets.service';
import { SettingsService } from '../../core/services/settings.service';

@Component({
  selector: 'app-toolbar',
  templateUrl: './toolbar.component.html',
  styleUrl: './toolbar.component.scss',
})
export class ToolbarComponent {
  protected readonly graphService = inject(GraphService);
  protected readonly repoGit = inject(RepoGitService);
  protected readonly secrets = inject(SecretsService);
  protected readonly settings = inject(SettingsService);
  protected readonly pickingRepo = signal(false);

  addNode(event: Event): void {
    event.stopPropagation();
    this.graphService.addArtifactNode();
  }

  addChecklist(event: Event): void {
    event.stopPropagation();
    this.graphService.addChecklistNode();
  }

  addRepo(event: Event): void {
    event.stopPropagation();
    if (this.pickingRepo()) return;
    void this.pickAndAddRepo();
  }

  private async pickAndAddRepo(): Promise<void> {
    this.pickingRepo.set(true);
    try {
      const path = await this.repoGit.pickFolder();
      if (!path) return;
      this.graphService.addRepoNode(path);
    } catch (err) {
      console.error('[layercoop] pick folder failed', err);
      window.alert(
        err instanceof Error
          ? err.message
          : 'Не удалось открыть выбор папки. Проверь, что bridge запущен.',
      );
    } finally {
      this.pickingRepo.set(false);
    }
  }

  onNameInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.graphService.setGraphName(value);
  }

  openSecrets(event: Event): void {
    event.stopPropagation();
    this.secrets.toggle();
  }

  openChat(event: Event): void {
    event.stopPropagation();
    const id = this.graphService.selectedNodeId();
    const node = id
      ? this.graphService.graph().nodes.find((n) => n.id === id)
      : undefined;
    const isRepo =
      !!node &&
      node.type === 'artifact' &&
      isArtifactData(node.data) &&
      node.data.kind === 'repo';
    if (!id || isRepo) {
      this.graphService.selectNode(GOD_NODE_ID);
    } else {
      this.graphService.openChatSidebar();
    }
  }

  openSettings(event: Event): void {
    event.stopPropagation();
    this.settings.toggle();
  }

  export(): void {
    void this.graphService.exportZip();
  }
}

import { Component, inject } from '@angular/core';
import { SettingsService } from '../../core/services/settings.service';

@Component({
  selector: 'app-settings-panel',
  templateUrl: './settings-panel.component.html',
  styleUrl: './settings-panel.component.scss',
})
export class SettingsPanelComponent {
  protected readonly settings = inject(SettingsService);

  close(): void {
    this.settings.close();
  }

  backdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.close();
  }

  onBoardAura(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.settings.setBoardAuraEnabled(checked);
  }
}

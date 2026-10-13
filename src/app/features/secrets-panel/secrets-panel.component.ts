import { Component, inject } from '@angular/core';
import { SecretsService } from '../../core/services/secrets.service';

@Component({
  selector: 'app-secrets-panel',
  templateUrl: './secrets-panel.component.html',
  styleUrl: './secrets-panel.component.scss',
})
export class SecretsPanelComponent {
  protected readonly secrets = inject(SecretsService);

  onKey(index: number, event: Event): void {
    this.secrets.setRow(index, { key: (event.target as HTMLInputElement).value });
  }

  onValue(index: number, event: Event): void {
    this.secrets.setRow(index, { value: (event.target as HTMLInputElement).value });
  }

  add(): void {
    this.secrets.addRow();
  }

  remove(index: number): void {
    this.secrets.removeRow(index);
  }

  save(): void {
    void this.secrets.save();
  }

  close(): void {
    this.secrets.close();
  }

  backdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.close();
  }
}

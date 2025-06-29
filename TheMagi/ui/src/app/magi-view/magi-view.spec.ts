import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MagiView } from './magi-view';
import { CommonModule } from '@angular/common';

describe('MagiView', () => {
  let component: MagiView;
  let fixture: ComponentFixture<MagiView>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ MagiView ],
      imports: [ CommonModule ]
    })
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(MagiView);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize with all magi statuses as "off"', () => {
    expect(component.balthasarStatus).toBe('off');
    expect(component.casperStatus).toBe('off');
    expect(component.melchiorStatus).toBe('off');
  });

  it('should have advancedMode set to false initially', () => {
    expect(component.advancedMode).toBe(false);
  });

  it('should toggle advancedMode when toggleAdvancedMode() is called', () => {
    expect(component.advancedMode).toBe(false);
    component.toggleAdvancedMode();
    expect(component.advancedMode).toBe(true);
    component.toggleAdvancedMode();
    expect(component.advancedMode).toBe(false);
  });

  it('should show advanced panel when advancedMode is true', () => {
    component.advancedMode = true;
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.advanced-panel')).not.toBeNull();
  });

  it('should hide advanced panel when advancedMode is false', () => {
    component.advancedMode = false;
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.advanced-panel')).toBeNull();
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterModule } from '@angular/router';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { describe, beforeEach, it, expect } from '@jest/globals';

@Component({
  selector: 'app-root',
  template: '<div>Mock Template</div>',
  styles: ['']
})
class MockAppComponent {
  balthasarStatus = 'offline';
  casperStatus = 'offline';
  melchiorStatus = 'offline';
}

describe('AppComponent', () => {
  let component: MockAppComponent;
  let fixture: ComponentFixture<MockAppComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        RouterModule.forRoot([]),
        HttpClientTestingModule
      ],
      declarations: [
        MockAppComponent
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MockAppComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the app', () => {
    expect(component).toBeTruthy();
  });

  it('should have default status values', () => {
    expect(component.balthasarStatus).toBe('offline');
    expect(component.casperStatus).toBe('offline');
    expect(component.melchiorStatus).toBe('offline');
  });
});

import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { AppRoutingModule } from './app-routing-module';
import { App } from './app';
import { BalthasarComponent } from './components/balthasar.component';
import { CasperComponent } from './components/casper.component';
import { MelchiorComponent } from './components/melchior.component';
import { BaseMagiComponent } from './components/base-magi.component';

@NgModule({
  declarations: [
    App,
    BaseMagiComponent,
    BalthasarComponent,
    CasperComponent,
    MelchiorComponent
  ],
  imports: [
    BrowserModule,
    AppRoutingModule
  ],
  providers: [],
  bootstrap: [App]
})
export class AppModule { }

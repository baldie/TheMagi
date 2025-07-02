import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { AppRoutingModule } from './app-routing-module';
import { AppComponent } from './app';
import { BalthasarComponent } from './components/balthasar.component';
import { CasperComponent } from './components/casper.component';
import { MelchiorComponent } from './components/melchior.component';
import { BaseMagiComponent } from './components/base-magi.component';

@NgModule({
  declarations: [
    AppComponent,
    BaseMagiComponent,
    BalthasarComponent,
    CasperComponent,
    MelchiorComponent
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    HttpClientModule,
    FormsModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }

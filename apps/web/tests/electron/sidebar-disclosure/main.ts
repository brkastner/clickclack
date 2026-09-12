import { mount } from "svelte";
import "../../../src/styles/index.css";
import Fixture from "./Fixture.svelte";
mount(Fixture, { target: document.getElementById("app")! });

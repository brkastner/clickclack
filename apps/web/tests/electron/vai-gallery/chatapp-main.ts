import "../../../src/styles/index.css";
import { mount } from "svelte";
import Fixture from "./ChatAppFixture.svelte";
mount(Fixture, { target: document.getElementById("app")! });

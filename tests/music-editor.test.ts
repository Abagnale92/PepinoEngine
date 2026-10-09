import { describe, expect, it } from "vitest";
import { replaceSoundRefs } from "../src/renderer/src/projectOps";
import { FLAT, makeProject, player, rule } from "./helpers";

describe("scheda Musica", () => {
  it("rinominando un suono si aggiornano blocchi, figli, modelli, Regole, filmati e musica delle scene", () => {
    const p = makeProject(
      FLAT,
      [
        {
          ...player(20, 100, { jumpSound: "bip" }),
          children: [{ id: "c", name: "Figlio", x: 0, y: 0, blocks: [{ type: "Health", props: { hurtSound: "bip" } }] }],
        },
      ],
      {
        rules: [rule("r", { type: "scene.start", params: {} }, [{ type: "audio.play", params: { sound: "bip" } }, { type: "message.show", params: { text: "bip" } }])],
        prefabs: [{ id: "m", name: "M", blocks: [{ type: "Health", props: { hurtSound: "bip" } }] }],
        cutscenes: [{ id: "f", name: "F", steps: [{ type: "audio.music", params: { music: "bip" } }] }],
      },
    );
    p.scenes[0].music = "bip";
    replaceSoundRefs(p, "bip", "laser");
    const s = p.scenes[0];
    expect(s.music).toBe("laser");
    expect(s.entities[0].blocks[1].props.jumpSound).toBe("laser");
    expect(s.entities[0].children![0].blocks[0].props.hurtSound).toBe("laser");
    expect(p.prefabs[0].blocks[0].props.hurtSound).toBe("laser");
    expect(s.rules![0].actions[0].params.sound).toBe("laser");
    // Un testo uguale al nome del suono non è un riferimento: resta com'è.
    expect(s.rules![0].actions[1].params.text).toBe("bip");
    expect(p.cutscenes![0].steps[0].params.music).toBe("laser");
  });
});

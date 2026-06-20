export class Vec3 {
    constructor(
        public x: number = 0,
        public y: number = 0,
        public z: number = 0
    ) {}

    add(b: Vec3): Vec3 {
        return new Vec3(this.x + b.x, this.y + b.y, this.z + b.z);
    }

    subtract(b: Vec3): Vec3 {
        return new Vec3(this.x - b.x, this.y - b.y, this.z - b.z);
    }

    scale(c: number): Vec3 {
        return new Vec3(this.x * c, this.y * c, this.z * c);
    }

    length(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    }

    normalize(): Vec3 {
        const len = this.length();
        if (len === 0) return new Vec3();
        return this.scale(1.0 / len);
    }

    distanceTo(b: Vec3): number {
        return this.subtract(b).length();
    }

    clone(): Vec3 {
        return new Vec3(this.x, this.y, this.z);
    }

    static fromGrid(x: number, z: number): Vec3 {
        return new Vec3(x, 0, z);
    }
}
